import { NOTE_MAX } from "@klipstack/api-contract/names"
import type { ArticleDetails, Highlight } from "@klipstack/sdk"
import type { NoteSaveStatus } from "@klipstack/sdk/note-autosave"
import { SymbolView } from "expo-symbols"
import { useRef } from "react"
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { MarkerText } from "@/components/marker-text"
import {
	LinkArticleButton,
	NoteField,
	type NoteFieldHandle,
	type NoteLinking,
} from "@/components/note-field"
import { PostIt, postItText } from "@/components/post-it"
import { withDictated } from "@/lib/dictated-note"
import { useDictation } from "@/lib/dictation"
import { t } from "@/lib/i18n"
import { fromStored } from "@/lib/note-field"
import { tiltFor } from "@/lib/post-it"
import { type Colors, fonts } from "@/lib/theme"

/**
 * The web reader's sidebar, as a sheet: which article it is (its title, byline and description, so
 * a note written after reading it, or before reading it again, has it in view), its note, a post-it written on in place,
 * its highlights below, each quote marked in its color with its note on a post-it, then the
 * articles whose notes link here. Tapping a highlight closes the sheet and shows it in the
 * article, with its tools; tapping a link or a linking article opens that article. Dictate writes
 * what is said into the note, recognized on the iPhone; `dictate` starts it as the sheet opens
 * (after an article read aloud).
 */
export function NotesSheet({
	visible,
	article,
	onClose,
	onDismiss,
	note,
	highlights,
	onSelect,
	linking,
	backlinks,
	dictate = false,
	onDictate,
	colors,
}: {
	visible: boolean
	/** The article the notes are on: its title, and site · author · minutes. */
	article: { title: string; byline: string; description: string | null }
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
	/** Start dictating as the sheet opens. */
	dictate?: boolean
	/** Dictation starts: the article read aloud pauses, so the microphone doesn't hear it. */
	onDictate?: () => void
	colors: Colors
}) {
	const field = useRef<NoteFieldHandle>(null)
	// The note as it was when dictation began: what is heard goes after it.
	const before = useRef("")
	const dictation = useDictation((heard) =>
		note.onChange(withDictated(before.current, heard, NOTE_MAX)),
	)
	const startDictation = () => {
		Keyboard.dismiss()
		onDictate?.()
		before.current = note.value
		void dictation.start()
	}
	const close = () => {
		dictation.stop()
		onClose()
	}
	return (
		<Modal
			visible={visible}
			presentationStyle="pageSheet"
			animationType="slide"
			onRequestClose={close}
			onShow={() => {
				if (dictate && dictation.available) startDictation()
			}}
			onDismiss={() => {
				dictation.stop()
				onDismiss()
			}}
		>
			<View style={[styles.sheet, { backgroundColor: colors.bg }]}>
				<View style={[styles.bar, { borderColor: colors.border }]}>
					<Text style={[styles.title, { color: colors.fg }]}>{t("reader.notes.title")}</Text>
					<Pressable accessibilityRole="button" onPress={close} hitSlop={12} style={styles.done}>
						<Text style={[styles.doneText, { color: colors.accent }]}>
							{t("common.actions.done")}
						</Text>
					</Pressable>
				</View>
				<ScrollView
					contentContainerStyle={styles.content}
					keyboardDismissMode="interactive"
					// Link Article works while typing, without closing the keyboard first.
					keyboardShouldPersistTaps="handled"
					automaticallyAdjustKeyboardInsets
				>
					<View style={styles.article}>
						<Text style={[styles.articleTitle, { color: colors.fg }]} numberOfLines={3}>
							{article.title}
						</Text>
						{article.byline ? (
							<Text style={[styles.byline, { color: colors.mutedFg }]} numberOfLines={1}>
								{article.byline}
							</Text>
						) : null}
						{article.description ? (
							<Text style={[styles.description, { color: colors.mutedFg }]} numberOfLines={3}>
								{article.description}
							</Text>
						) : null}
					</View>
					<View style={styles.heading}>
						{/* The same note as the post-it at the end of the article, and as private. */}
						<Text style={[styles.label, { color: colors.mutedFg }]}>
							{t("reader.notes.yourNote")}
							<Text style={styles.onlyYou}>{t("reader.notes.onlyYou")}</Text>
						</Text>
						<NoteStatus status={note.status} onRetry={note.onFlush} colors={colors} />
					</View>
					{/* Written straight on the paper: the editor is the note. The sheet's whole width: a
					phone is narrow enough, and a note grows here as it is written or dictated. */}
					<PostIt colors={colors} style={styles.paper}>
						<NoteField
							ref={field}
							accessibilityLabel={t("reader.notes.yourNote")}
							value={note.value}
							onChange={(text) => {
								// Typed while listening: what is heard next would write over it.
								dictation.drop()
								note.onChange(text)
							}}
							onBlur={note.onFlush}
							linking={linking}
							scrollEnabled={false}
							maxLength={NOTE_MAX}
							placeholder={ARTICLE_NOTE_PLACEHOLDER}
							placeholderColor={colors.note.placeholder}
							colors={colors}
							style={[postItText(colors), styles.note]}
						/>
					</PostIt>
					<View style={styles.tools}>
						<LinkArticleButton field={field} colors={colors} />
						{dictation.available ? (
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={
									dictation.listening ? t("reader.notes.stopDictating") : t("reader.notes.dictate")
								}
								onPress={dictation.listening ? dictation.stop : startDictation}
								hitSlop={8}
								style={styles.linkArticle}
							>
								<SymbolView
									name={dictation.listening ? "stop.circle.fill" : "mic"}
									tintColor={dictation.listening ? colors.danger : colors.accent}
									size={17}
								/>
								<Text
									style={[
										styles.linkArticleText,
										{ color: dictation.listening ? colors.danger : colors.accent },
									]}
								>
									{dictation.listening ? t("reader.notes.listening") : t("reader.notes.dictate")}
								</Text>
							</Pressable>
						) : null}
					</View>
					<Text style={[styles.label, styles.highlightsLabel, { color: colors.mutedFg }]}>
						{highlights.length
							? t("reader.notes.highlightsCount", { number: highlights.length })
							: t("reader.notes.highlights")}
					</Text>
					{highlights.length === 0 ? (
						<Text style={[styles.empty, { color: colors.mutedFg }]}>{t("reader.notes.empty")}</Text>
					) : (
						highlights.map((h) => (
							<Pressable
								key={h.id}
								accessibilityRole="button"
								accessibilityHint={t("reader.notes.showInArticle")}
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
											color={h.color}
											colors={colors}
											style={styles.highlightNote}
										>
											{/* Links as their titles. */}
											<Text style={postItText(colors, "compact", h.color)}>
												{fromStored(h.note).text}
											</Text>
										</PostIt>
									) : null}
								</View>
							</Pressable>
						))
					)}
					{backlinks.length ? (
						<>
							<Text style={[styles.label, styles.highlightsLabel, { color: colors.mutedFg }]}>
								{t("reader.notes.linkedFrom")}
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
		return (
			<Text style={[styles.status, { color: colors.mutedFg }]}>{t("reader.notes.saving")}</Text>
		)
	if (status === "saved")
		return <Text style={[styles.status, { color: colors.mutedFg }]}>{t("reader.notes.saved")}</Text>
	if (status === "error")
		return (
			<Pressable accessibilityRole="button" onPress={onRetry} hitSlop={8}>
				<Text style={[styles.status, { color: colors.danger }]}>{t("reader.notes.failed")}</Text>
			</Pressable>
		)
	return null
}

const ARTICLE_NOTE_PLACEHOLDER = t("reader.notes.placeholder")

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
	title: { fontFamily: fonts.display, fontSize: 19 },
	done: { position: "absolute", right: 16 },
	doneText: { fontSize: 17, fontWeight: "600" },
	content: { padding: 16, paddingBottom: 48 },
	article: { gap: 4, marginBottom: 24 },
	articleTitle: { fontFamily: fonts.display, fontSize: 22, lineHeight: 27 },
	byline: { fontSize: 14 },
	description: { fontSize: 15, lineHeight: 20, marginTop: 4 },
	heading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
	// A section's name, as the web's sidebar sets it.
	label: { fontFamily: fonts.display, fontSize: 17, marginBottom: 8 },
	onlyYou: { fontFamily: fonts.displayItalic },
	status: { fontSize: 13, marginBottom: 8 },
	// Room above for the tape.
	paper: { marginTop: 10, alignSelf: "stretch" },
	// The whole paper takes the tap.
	note: { flexGrow: 1, minHeight: 100, padding: 0, paddingTop: 0, textAlignVertical: "top" },
	tools: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 20, marginTop: 10 },
	linkArticle: { flexDirection: "row", alignItems: "center", gap: 6 },
	linkArticleText: { fontSize: 15 },
	highlightsLabel: { marginTop: 28 },
	empty: { fontFamily: fonts.serif, fontStyle: "italic", fontSize: 17, lineHeight: 23 },
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
