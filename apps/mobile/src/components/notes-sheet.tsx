import { NOTE_MAX } from "@klipstack/api-contract/names"
import type { ArticleDetails, Highlight } from "@klipstack/sdk"
import type { NoteSaveStatus } from "@klipstack/sdk/note-autosave"
import { SymbolView } from "expo-symbols"
import { useRef } from "react"
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { MarkerText } from "@/components/marker-text"
import { NoteField, type NoteFieldHandle, type NoteLinking } from "@/components/note-field"
import { PostIt, postItText, useGrowingFit } from "@/components/post-it"
import { fromStored } from "@/lib/note-field"
import { tiltFor } from "@/lib/post-it"
import type { Colors } from "@/lib/theme"

/**
 * The web reader's sidebar, as a sheet: the article's note on top, a post-it written on in place,
 * its highlights below, each quote marked in its color with its note on a post-it, then the
 * articles whose notes link here. Tapping a highlight closes the sheet and shows it in the
 * article, with its tools; tapping a link or a linking article opens that article.
 */
export function NotesSheet({
	visible,
	onClose,
	onDismiss,
	note,
	highlights,
	onSelect,
	linking,
	backlinks,
	colors,
}: {
	visible: boolean
	onClose: () => void
	/** After the sheet is gone, however it was closed. */
	onDismiss: () => void
	note: {
		value: string
		status: NoteSaveStatus
		onChange: (text: string) => void
		onFlush: () => void
	}
	highlights: Highlight[]
	onSelect: (id: string) => void
	linking: NoteLinking
	backlinks: ArticleDetails["noteLinks"]["from"]
	colors: Colors
}) {
	const field = useRef<NoteFieldHandle>(null)
	// Sized afresh each time the sheet opens: a note cleared last time is small again.
	const fit = useGrowingFit(note.value, String(visible))
	return (
		<Modal
			visible={visible}
			presentationStyle="pageSheet"
			animationType="slide"
			onRequestClose={onClose}
			onDismiss={onDismiss}
		>
			<View style={[styles.sheet, { backgroundColor: colors.bg }]}>
				<View style={[styles.bar, { borderColor: colors.border }]}>
					<Text style={[styles.title, { color: colors.fg }]}>Notes</Text>
					<Pressable accessibilityRole="button" onPress={onClose} hitSlop={12} style={styles.done}>
						<Text style={[styles.doneText, { color: colors.accent }]}>Done</Text>
					</Pressable>
				</View>
				<ScrollView
					contentContainerStyle={styles.content}
					keyboardDismissMode="interactive"
					// Link Article works while typing, without closing the keyboard first.
					keyboardShouldPersistTaps="handled"
					automaticallyAdjustKeyboardInsets
				>
					<View style={styles.heading}>
						{/* The same note as the post-it at the end of the article, and as private. */}
						<Text style={[styles.label, { color: colors.mutedFg }]}>
							YOUR NOTE<Text style={styles.onlyYou}> · ONLY YOU</Text>
						</Text>
						<NoteStatus status={note.status} onRetry={note.onFlush} colors={colors} />
					</View>
					{/* Written straight on the paper: the editor is the note. */}
					<PostIt
						variant="compact"
						fit={fit || ARTICLE_NOTE_PLACEHOLDER}
						colors={colors}
						style={styles.paper}
					>
						<NoteField
							ref={field}
							accessibilityLabel="Your note"
							value={note.value}
							onChange={note.onChange}
							onBlur={note.onFlush}
							linking={linking}
							scrollEnabled={false}
							maxLength={NOTE_MAX}
							placeholder={ARTICLE_NOTE_PLACEHOLDER}
							placeholderColor={colors.note.placeholder}
							colors={colors}
							style={[postItText(colors, "compact"), styles.note]}
						/>
					</PostIt>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Link Article"
						onPress={() => field.current?.linkArticle()}
						hitSlop={8}
						style={styles.linkArticle}
					>
						<SymbolView name="link" tintColor={colors.accent} size={17} />
						<Text style={[styles.linkArticleText, { color: colors.accent }]}>Link Article</Text>
					</Pressable>
					<Text style={[styles.label, styles.highlightsLabel, { color: colors.mutedFg }]}>
						{highlights.length ? `HIGHLIGHTS (${highlights.length})` : "HIGHLIGHTS"}
					</Text>
					{highlights.length === 0 ? (
						<Text style={[styles.empty, { color: colors.mutedFg }]}>
							Select text in the article, then tap Highlight.
						</Text>
					) : (
						highlights.map((h) => (
							<Pressable
								key={h.id}
								accessibilityRole="button"
								accessibilityHint="Shows it in the article"
								onPress={() => onSelect(h.id)}
								style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.muted }]}
							>
								<View style={styles.grow}>
									{/* Marked as it is in the article, in its color. */}
									<MarkerText
										text={oneLine(h.quote)}
										color={h.color}
										seed={h.id}
										numberOfLines={4}
										colors={colors}
										style={[styles.quote, { color: colors.fg }]}
									/>
									{h.note ? (
										<PostIt
											variant="compact"
											fit={h.note}
											tilt={tiltFor(h.id)}
											colors={colors}
											style={styles.highlightNote}
										>
											{/* Links as their titles. */}
											<Text style={postItText(colors, "compact")}>{fromStored(h.note).text}</Text>
										</PostIt>
									) : null}
								</View>
							</Pressable>
						))
					)}
					{backlinks.length ? (
						<>
							<Text style={[styles.label, styles.highlightsLabel, { color: colors.mutedFg }]}>
								LINKED FROM YOUR NOTES
							</Text>
							{backlinks.map((link) => (
								<Pressable
									key={`${link.id}:${link.highlight?.id ?? ""}`}
									accessibilityRole="link"
									onPress={() => linking.open(link.id)}
									style={({ pressed }) => [
										styles.row,
										pressed && { backgroundColor: colors.muted },
									]}
								>
									<View style={styles.grow}>
										<Text style={[styles.linkTitle, { color: colors.fg }]} numberOfLines={2}>
											{link.title ?? link.url}
										</Text>
										{link.highlight?.quote ? (
											<Text
												style={[styles.backlinkQuote, { color: colors.mutedFg }]}
												numberOfLines={1}
											>
												{link.highlight.quote}
											</Text>
										) : null}
									</View>
								</Pressable>
							))}
						</>
					) : null}
				</ScrollView>
			</View>
		</Modal>
	)
}

function NoteStatus({
	status,
	onRetry,
	colors,
}: {
	status: NoteSaveStatus
	onRetry: () => void
	colors: Colors
}) {
	if (status === "saving")
		return <Text style={[styles.status, { color: colors.mutedFg }]}>Saving…</Text>
	if (status === "saved")
		return <Text style={[styles.status, { color: colors.mutedFg }]}>Saved</Text>
	if (status === "error")
		return (
			<Pressable accessibilityRole="button" onPress={onRetry} hitSlop={8}>
				<Text style={[styles.status, { color: colors.danger }]}>Not saved · Retry</Text>
			</Pressable>
		)
	return null
}

const ARTICLE_NOTE_PLACEHOLDER = "Your thoughts on this article"

/** Runs of spaces and line breaks as one space, as the web shows a quote. */
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim()

const styles = StyleSheet.create({
	sheet: { flex: 1 },
	bar: {
		height: 56,
		alignItems: "center",
		justifyContent: "center",
		borderBottomWidth: StyleSheet.hairlineWidth,
	},
	title: { fontSize: 17, fontWeight: "600" },
	done: { position: "absolute", right: 16 },
	doneText: { fontSize: 17, fontWeight: "600" },
	content: { padding: 16, paddingBottom: 48 },
	heading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
	label: { fontSize: 13, fontWeight: "500", letterSpacing: 0.4, marginBottom: 8 },
	onlyYou: { fontWeight: "400" },
	status: { fontSize: 13, marginBottom: 8 },
	// Room above for the tape.
	paper: { marginTop: 6 },
	// The whole paper takes the tap.
	note: { flexGrow: 1, minHeight: 66, padding: 0, paddingTop: 0, textAlignVertical: "top" },
	linkArticle: {
		flexDirection: "row",
		alignItems: "center",
		alignSelf: "flex-start",
		gap: 6,
		marginTop: 10,
	},
	linkArticleText: { fontSize: 15 },
	highlightsLabel: { marginTop: 28 },
	empty: { fontSize: 15, lineHeight: 21 },
	row: {
		flexDirection: "row",
		gap: 10,
		paddingVertical: 10,
		paddingHorizontal: 6,
		borderRadius: 10,
	},
	grow: { flex: 1, gap: 4 },
	quote: { fontFamily: "Iowan Old Style", fontSize: 17, lineHeight: 24 },
	highlightNote: { marginTop: 14, marginBottom: 6 },
	backlinkQuote: { fontSize: 15, lineHeight: 20 },
	linkTitle: { fontSize: 17, lineHeight: 22 },
})
