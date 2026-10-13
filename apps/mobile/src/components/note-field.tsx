import type { ArticleSummary } from "@klipstack/sdk"
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
import { applyEdit, fromStored, insertLink, type NoteState, runs, toStored } from "@/lib/note-field"
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

/** What the screen around a note field can ask of it. */
export type NoteFieldHandle = {
	/** Opens the article picker; the link goes where the cursor was, or at the end. */
	linkArticle: () => void
}

/**
 * A note's text field that shows links to other articles as their titles (the stored form is
 * `[Title](/read/<id>)`, `src/lib/note-field.ts`). Words in a text field can't be tapped, so while
 * it isn't being edited a note with links shows as text whose titles open their articles; a tap
 * elsewhere edits it. The screen's Link Article button (`ref.linkArticle`) inserts a link. It
 * can't sit above the keyboard: a button there gets no touches while the field is in a sheet.
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
	useImperativeHandle(ref, () => ({ linkArticle: () => setPicking(true) }), [])

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
		// The selection as last reported; a note loaded since may be shorter.
		const length = current.current.text.length
		const within = {
			start: Math.min(selection.current.start, length),
			end: Math.min(selection.current.end, length),
		}
		const { state: next, cursor: at } = insertLink(current.current, within, {
			id: article.id,
			title: article.title ?? article.url,
		})
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
			onClose={() => setPicking(false)}
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
				onBlur={() => {
					if (!picking) setEditing(false)
					onBlur()
				}}
				onChangeText={(text) => {
					const { state: next, cursor: at } = applyEdit(current.current, text)
					update(next, at)
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
