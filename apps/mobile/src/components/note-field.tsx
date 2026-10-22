import type { ArticleSummary, KlipstackClient } from "@klipstack/sdk"
import { router } from "expo-router"
import { SymbolView } from "expo-symbols"
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react"
import {
	Pressable,
	type StyleProp,
	StyleSheet,
	Text,
	TextInput,
	type TextStyle,
	type ViewStyle,
} from "react-native"
import { LinkArticleSheet } from "@/components/link-article-sheet"
import {
	applyEdit,
	fromStored,
	insertLink,
	linkRange,
	type NoteState,
	runs,
	toStored,
	typedTrigger,
} from "@/lib/note-field"
import type { Colors } from "@/lib/theme"

/** What a note field needs for links to other articles; the reader provides it. */
export type NoteLinking = {
	/** `trash` and `missing` targets show struck through and greyed, as on the web. */
	status: (id: string) => "ok" | "trash" | "missing"
	open: (id: string) => void
	search: (q: string) => Promise<ArticleSummary[]>
	recent: () => Promise<ArticleSummary[]>
	/** The article being read: not offered as a link. */
	articleId: string
}

/**
 * Links in notes on a screen of cards (the Notebook, Home's highlights): shown as `linkTargets`
 * says their articles are, opened in the reader, and picked from the library.
 */
export function noteLinking(
	client: KlipstackClient | null,
	linkTargets: Record<string, "ok" | "trash"> | undefined,
): (articleId: string) => NoteLinking {
	return (articleId) => ({
		// An id the answer leaves out is gone.
		status: (id) => linkTargets?.[id] ?? "missing",
		open: (id) => router.push({ pathname: "/read/[id]", params: { id } }),
		search: async (text) =>
			client ? (await client.articles.search(text, { limit: 20 })).items : [],
		recent: async () =>
			client ? (await client.articles.list({ view: "inbox", sort: "recent", limit: 9 })).items : [],
		articleId,
	})
}

/** What the screen around a note field can ask of it. */
export type NoteFieldHandle = {
	/** Opens the article picker; the link goes where the cursor was, or at the end. */
	linkArticle: () => void
}

/**
 * A note's text field that shows links to other articles as their titles (the stored form is
 * `[Title](/read/<id>)`, `src/lib/note-field.ts`). Words in a text field can't be tapped, so while
 * it isn't being edited a note with links shows as text whose titles open their articles; a tap
 * elsewhere edits it. Typing `[[` or `@` opens the article picker, as on the web, and the link
 * picked takes their place; closed without one, they stay as typed. The screen's Link Article
 * button (`ref.linkArticle`) opens it too. It can't sit above the keyboard: a button there gets
 * no touches while the field is in a sheet.
 */
export function NoteField({
	value,
	onChange,
	onBlur,
	linking,
	accessibilityLabel,
	placeholder,
	placeholderColor,
	maxLength,
	scrollEnabled,
	autoFocus = false,
	style,
	colors,
	ref,
}: {
	/** The stored note. */
	value: string
	onChange: (stored: string) => void
	onBlur: () => void
	linking: NoteLinking
	accessibilityLabel: string
	placeholder: string
	/** The placeholder's color, on paper of another color (a post-it); muted by default. */
	placeholderColor?: string
	maxLength: number
	scrollEnabled?: boolean
	/** Editing from the start, with the caret at the end: the field took the place of the note's text. */
	autoFocus?: boolean
	style: StyleProp<TextStyle>
	colors: Colors
	ref?: Ref<NoteFieldHandle>
}) {
	const [state, setState] = useState(() => fromStored(value))
	// The latest note, for edits that come faster than renders; every change sets both.
	const current = useRef(state)
	// A change from outside (a note loaded or reset) replaces what the field holds.
	useEffect(() => {
		if (value === toStored(current.current)) return
		current.current = fromStored(value)
		setState(current.current)
	}, [value])

	const input = useRef<TextInput>(null)
	const [editing, setEditing] = useState(autoFocus)
	const selection = useRef({ start: state.text.length, end: state.text.length })
	// Where the cursor must go once the field shows the text it was just given.
	const cursor = useRef<number | null>(null)
	const [picking, setPicking] = useState(false)
	// The `[[` or `@` that opened the picker: the link replaces it.
	const trigger = useRef<{ start: number; end: number } | null>(null)
	useImperativeHandle(
		ref,
		() => ({
			linkArticle: () => {
				trigger.current = null
				setPicking(true)
			},
		}),
		[],
	)

	// A deletion that took a whole link: the cursor goes where the link was.
	useEffect(() => {
		const at = cursor.current
		if (at === null || !input.current?.isFocused()) return
		cursor.current = null
		input.current.setSelection(at, at)
	}, [state])

	function update(next: NoteState, at?: number) {
		if (at !== undefined) cursor.current = at
		current.current = next
		setState(next)
		onChange(toStored(next))
	}

	function pick(article: ArticleSummary) {
		setPicking(false)
		// The trigger typed, or the selection as last reported; a note loaded since may differ.
		const within = linkRange(current.current.text, trigger.current, selection.current)
		trigger.current = null
		const { state: next, cursor: at } = insertLink(current.current, within, {
			id: article.id,
			title: article.title ?? article.url,
		})
		// Past the longest note the server keeps, the link would only be refused on save.
		if (toStored(next).length > maxLength) return
		update(next, at)
	}

	const linkStyle = (id: string): TextStyle => {
		const status = linking.status(id)
		if (status === "trash")
			return { color: colors.mutedFg, textDecorationLine: "line-through" as const }
		// Underlined, as links are: the link color alone is close to the text's.
		return {
			color: status === "ok" ? colors.accent : colors.mutedFg,
			textDecorationLine: "underline" as const,
		}
	}
	const { text: textStyle, box } = split(style)

	const sheet = (
		<LinkArticleSheet
			visible={picking}
			onClose={() => {
				trigger.current = null
				setPicking(false)
			}}
			onPick={pick}
			// Back to the note, with the cursor after the new link.
			onDismissed={() => {
				setEditing(true)
				input.current?.focus()
			}}
			search={linking.search}
			recent={linking.recent}
			exclude={linking.articleId}
			colors={colors}
		/>
	)

	if (!editing && !picking && state.links.length > 0)
		return (
			<>
				<Pressable
					accessibilityLabel={accessibilityLabel}
					accessibilityHint="Edits the note"
					onPress={() => setEditing(true)}
					style={box}
				>
					<Text style={textStyle}>
						{runs(state).map((run) =>
							run.link ? (
								<Text
									key={run.start}
									accessibilityRole="link"
									onPress={() => run.link && linking.open(run.link.id)}
									style={linkStyle(run.link.id)}
								>
									{run.text}
								</Text>
							) : (
								run.text
							),
						)}
					</Text>
				</Pressable>
				{sheet}
			</>
		)

	return (
		<>
			<TextInput
				ref={input}
				accessibilityLabel={accessibilityLabel}
				autoFocus={editing}
				onFocus={() => {
					setEditing(true)
					const at = cursor.current
					if (at === null) return
					cursor.current = null
					input.current?.setSelection(at, at)
				}}
				// The picker's sheet takes the focus: still writing, back in the note once it closes.
				onBlur={() => {
					if (picking) return
					setEditing(false)
					onBlur()
				}}
				onChangeText={(text) => {
					const typed = typedTrigger(current.current.text, text)
					const { state: next, cursor: at } = applyEdit(current.current, text)
					update(next, at)
					if (!typed) return
					trigger.current = typed
					setPicking(true)
				}}
				onSelectionChange={(event) => {
					selection.current = event.nativeEvent.selection
				}}
				multiline
				scrollEnabled={scrollEnabled}
				maxLength={maxLength}
				placeholder={placeholder}
				placeholderTextColor={placeholderColor ?? colors.mutedFg}
				style={style}
			>
				{state.text
					? runs(state).map((run) =>
							run.link ? (
								<Text key={run.start} style={linkStyle(run.link.id)}>
									{run.text}
								</Text>
							) : (
								<Text key={run.start}>{run.text}</Text>
							),
						)
					: null}
			</TextInput>
			{sheet}
		</>
	)
}

/**
 * Opens a note field's article picker (`ref.linkArticle`): under an article note, with its name;
 * `compact`, the icon alone, under a highlight's small note. The screen's list must let taps
 * through while the keyboard is up (`keyboardShouldPersistTaps="handled"`).
 */
export function LinkArticleButton({
	field,
	compact = false,
	colors,
}: {
	field: { current: NoteFieldHandle | null }
	compact?: boolean
	colors: Colors
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel="Link Article"
			onPress={() => field.current?.linkArticle()}
			hitSlop={8}
			style={styles.linkArticle}
		>
			<SymbolView name="link" tintColor={colors.accent} size={17} />
			{compact ? null : (
				<Text style={[styles.linkArticleText, { color: colors.accent }]}>Link Article</Text>
			)}
		</Pressable>
	)
}

const styles = StyleSheet.create({
	linkArticle: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
	linkArticleText: { fontSize: 15 },
})

const TEXT_KEYS = new Set([
	"color",
	"fontSize",
	"lineHeight",
	"fontFamily",
	"fontWeight",
	"fontStyle",
])

/** A field's style as the text's own and the box's (padding, border, background). */
function split(style: StyleProp<TextStyle>): { text: TextStyle; box: ViewStyle } {
	const text: Record<string, unknown> = {}
	const box: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(StyleSheet.flatten(style) ?? {}))
		(TEXT_KEYS.has(key) ? text : box)[key] = value
	return { text, box }
}
