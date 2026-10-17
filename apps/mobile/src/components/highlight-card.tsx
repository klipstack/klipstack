import type { HighlightColor } from "@klipstack/api-contract/enums"
import { HIGHLIGHT_NOTE_MAX } from "@klipstack/api-contract/names"
import type { Highlight } from "@klipstack/sdk"
import { createNoteAutosave, type NoteSaveStatus } from "@klipstack/sdk/note-autosave"
import { SymbolView } from "expo-symbols"
import { type Ref, useEffect, useRef, useState } from "react"
import {
	AccessibilityInfo,
	Animated,
	Easing,
	Keyboard,
	KeyboardAvoidingView,
	Pressable,
	StyleSheet,
	Text,
	useWindowDimensions,
	View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { HighlighterNibs } from "@/components/highlighter-nibs"
import { NoteField, type NoteFieldHandle, type NoteLinking } from "@/components/note-field"
import { notePaper, PostIt, postItText, useGrowingFit } from "@/components/post-it"
import { tiltFor } from "@/lib/post-it"
import type { Colors } from "@/lib/theme"

/**
 * One highlight's tools, as a card at the bottom that leaves the article in view: its color (marker
 * tips) and Done, its note (a post-it written on in place, saved as it's typed, like the article
 * note), Copy, Share, Link and Delete: the web reader's toolbar, and the Notebook card's menu.
 * Not a modal: the article above it still takes touches, for the highlight's handles, another
 * highlight, or a tap elsewhere that closes it (the page says so). It slides in and out.
 */
export function HighlightCard({
	highlight,
	onClose,
	onColor,
	saveNote,
	onCopy,
	onShare,
	onDelete,
	onCover,
	onDismissed,
	linking,
	colors,
}: {
	highlight: Highlight | null
	onClose: () => void
	onColor: (color: HighlightColor) => void
	saveNote: (id: string, note: string | null) => Promise<void>
	onCopy: () => void
	onShare: () => void
	onDelete: () => void
	/** How much of the screen's bottom the card covers, keyboard included, as it changes. */
	onCover: (points: number) => void
	/** After the card is gone, however it was closed. */
	onDismissed: () => void
	linking: NoteLinking
	colors: Colors
}) {
	const insets = useSafeAreaInsets()
	const { height } = useWindowDimensions()
	const note = useRef<NoteFieldHandle>(null)
	// The highlight shown: the last one while the card slides out.
	const [shown, setShown] = useState<Highlight | null>(highlight)
	if (highlight && highlight !== shown) setShown(highlight)
	const [slide] = useState(() => new Animated.Value(highlight ? 0 : 1))
	const [cardHeight, setCardHeight] = useState(320)
	const dismissed = useRef(onDismissed)
	useEffect(() => {
		dismissed.current = onDismissed
	})
	const open = highlight !== null
	useEffect(() => {
		let live = true
		if (!open) Keyboard.dismiss()
		void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
			if (!live) return
			Animated.timing(slide, {
				toValue: open ? 0 : 1,
				duration: reduce ? 0 : open ? 260 : 200,
				easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
				useNativeDriver: true,
			}).start(({ finished }) => {
				if (!finished || open || !live) return
				setShown(null)
				dismissed.current()
			})
		})
		return () => {
			live = false
		}
	}, [open, slide])
	if (!shown) return null
	return (
		<View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
			<KeyboardAvoidingView behavior="padding" pointerEvents="box-none" style={styles.bottom}>
				<Animated.View
					// The card's top moves with the keyboard; below it is covered.
					onLayout={(event) => {
						setCardHeight(event.nativeEvent.layout.height)
						onCover(height - event.nativeEvent.layout.y)
					}}
					style={[
						styles.card,
						{
							backgroundColor: colors.bg,
							borderColor: colors.border,
							paddingBottom: Math.max(insets.bottom, 16),
							transform: [
								{
									translateY: slide.interpolate({
										inputRange: [0, 1],
										outputRange: [0, cardHeight + 24],
									}),
								},
							],
						},
					]}
				>
					<View style={styles.top}>
						<HighlighterNibs value={shown.color} onChange={onColor} colors={colors} />
						<Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
							<Text style={[styles.done, { color: colors.accent }]}>Done</Text>
						</Pressable>
					</View>
					{/* A new highlight's autosave: the key resets it. */}
					<HighlightNote
						key={shown.id}
						highlight={shown}
						save={saveNote}
						linking={linking}
						colors={colors}
						field={note}
					/>
					<View style={styles.actions}>
						<Tool label="Copy" symbol="doc.on.doc" color={colors.accent} onPress={onCopy} />
						<Tool
							label="Share"
							symbol="square.and.arrow.up"
							color={colors.accent}
							onPress={onShare}
						/>
						<Tool
							label="Link"
							symbol="link"
							color={colors.accent}
							onPress={() => note.current?.linkArticle()}
						/>
						<Tool label="Delete" symbol="trash" color={colors.danger} onPress={onDelete} />
					</View>
				</Animated.View>
			</KeyboardAvoidingView>
		</View>
	)
}

function HighlightNote({
	highlight,
	save,
	linking,
	colors,
	field,
}: {
	highlight: Highlight
	/** Called with the card's first `save`: it must not depend on render state. */
	save: (id: string, note: string | null) => Promise<void>
	linking: NoteLinking
	colors: Colors
	field: Ref<NoteFieldHandle>
}) {
	const [value, setValue] = useState(highlight.note ?? "")
	const [status, setStatus] = useState<NoteSaveStatus>("idle")
	const [autosave] = useState(() =>
		createNoteAutosave({
			initial: highlight.note ?? "",
			onStatus: setStatus,
			save: (text) => save(highlight.id, text.trim() ? text : null),
		}),
	)
	// Closing the card saves what was typed.
	useEffect(
		() => () => {
			void autosave.flush()
			autosave.dispose()
		},
		[autosave],
	)

	// The paper grows as the note is written, and leans as the note does wherever it shows.
	const fit = useGrowingFit(value, highlight.id)
	return (
		<View>
			<PostIt
				fit={fit || NOTE_PLACEHOLDER}
				tilt={tiltFor(highlight.id)}
				blank={!value}
				color={highlight.color}
				colors={colors}
				style={styles.paper}
			>
				<NoteField
					ref={field}
					accessibilityLabel="Highlight note"
					value={value}
					onChange={(text) => {
						setValue(text)
						autosave.change(text)
					}}
					onBlur={() => void autosave.flush()}
					linking={linking}
					maxLength={HIGHLIGHT_NOTE_MAX}
					placeholder={NOTE_PLACEHOLDER}
					placeholderColor={notePaper(colors, highlight.color).placeholder}
					colors={colors}
					style={[postItText(colors, "full", highlight.color), styles.note]}
				/>
			</PostIt>
			{status === "error" ? (
				<Pressable accessibilityRole="button" onPress={() => void autosave.flush()}>
					<Text style={[styles.status, { color: colors.danger }]}>Note not saved · Retry</Text>
				</Pressable>
			) : status === "saving" ? (
				<Text style={[styles.status, { color: colors.mutedFg }]}>Saving…</Text>
			) : null}
		</View>
	)
}

const NOTE_PLACEHOLDER = "Add a note"

function Tool({
	label,
	symbol,
	color,
	onPress,
}: {
	label: string
	symbol: "doc.on.doc" | "square.and.arrow.up" | "link" | "trash"
	color: string
	onPress: () => void
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			onPress={onPress}
			hitSlop={8}
			style={styles.tool}
		>
			<SymbolView name={symbol} tintColor={color} size={18} />
			<Text style={[styles.toolText, { color }]}>{label}</Text>
		</Pressable>
	)
}

const styles = StyleSheet.create({
	bottom: { flex: 1, justifyContent: "flex-end" },
	card: {
		gap: 14,
		paddingTop: 14,
		paddingHorizontal: 16,
		borderTopLeftRadius: 20,
		borderTopRightRadius: 20,
		borderWidth: StyleSheet.hairlineWidth,
		shadowColor: "#000",
		shadowOpacity: 0.18,
		shadowRadius: 16,
		shadowOffset: { width: 0, height: -2 },
	},
	top: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingRight: 4,
	},
	// Room above for the tape; the paper's own size, in the middle.
	paper: { alignSelf: "center", marginTop: 8, marginBottom: 4 },
	// The whole paper takes the tap; a long note scrolls.
	note: { flexGrow: 1, maxHeight: 200, padding: 0, paddingTop: 0 },
	status: { fontSize: 13, marginTop: 6, textAlign: "center" },
	actions: { flexDirection: "row", alignItems: "center", gap: 24, paddingHorizontal: 4 },
	tool: { flexDirection: "row", alignItems: "center", gap: 6 },
	toolText: { fontSize: 16 },
	done: { fontSize: 17, fontWeight: "600" },
})
