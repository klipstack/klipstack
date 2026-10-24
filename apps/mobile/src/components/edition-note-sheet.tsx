import { NOTE_MAX } from "@klipstack/api-contract/names"
import type { NoteSaveStatus } from "@klipstack/sdk/note-autosave"
import { SymbolView } from "expo-symbols"
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { editionFromNote } from "@/lib/edition-note"
import { t } from "@/lib/i18n"
import type { Colors } from "@/lib/theme"

/**
 * The note for the next edition's readers, from the end of the article: what the edition shows
 * with the article, under the user's name, unlike the private note. It saves as it is typed; Done
 * closes the sheet. The web reader's card under "Added to your next edition". "Start from my note"
 * copies the private note in, to edit into something for the edition's readers.
 */
export function EditionNoteSheet({
	visible,
	onClose,
	onDismiss,
	note,
	privateNote,
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
	/** The article's private note, as stored. */
	privateNote: string
	colors: Colors
}) {
	const fromNote = editionFromNote(note.value, privateNote)
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
					<Text style={[styles.title, { color: colors.fg }]}>{t("reader.editionNote.title")}</Text>
					<Pressable accessibilityRole="button" onPress={onClose} hitSlop={12} style={styles.done}>
						<Text style={[styles.doneText, { color: colors.accent }]}>
							{t("common.actions.done")}
						</Text>
					</Pressable>
				</View>
				<ScrollView
					contentContainerStyle={styles.content}
					keyboardDismissMode="interactive"
					keyboardShouldPersistTaps="handled"
					automaticallyAdjustKeyboardInsets
				>
					<TextInput
						accessibilityLabel={t("reader.editionNote.label")}
						value={note.value}
						onChangeText={note.onChange}
						onBlur={note.onFlush}
						multiline
						// Opened to write: the keyboard comes up with the sheet.
						autoFocus
						scrollEnabled={false}
						maxLength={NOTE_MAX}
						placeholder={t("reader.page.editionPlaceholder")}
						placeholderTextColor={colors.mutedFg}
						style={[
							styles.note,
							{ color: colors.fg, backgroundColor: colors.muted, borderColor: colors.border },
						]}
					/>
					<SaveStatus status={note.status} onRetry={note.onFlush} colors={colors} />
					{fromNote !== null ? (
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={t("reader.editionNote.fromNote")}
							accessibilityHint={t("reader.editionNote.fromNoteHint")}
							onPress={() => note.onChange(fromNote)}
							hitSlop={8}
							style={styles.fromNote}
						>
							<SymbolView name="note.text" tintColor={colors.accent} size={17} />
							<Text style={[styles.fromNoteText, { color: colors.accent }]}>
								{t("reader.editionNote.fromNote")}
							</Text>
						</Pressable>
					) : null}
				</ScrollView>
			</View>
		</Modal>
	)
}

function SaveStatus({
	status,
	onRetry,
	colors,
}: {
	status: NoteSaveStatus
	onRetry: () => void
	colors: Colors
}) {
	if (status === "error")
		return (
			<Pressable accessibilityRole="button" onPress={onRetry} hitSlop={8}>
				<Text style={[styles.status, { color: colors.danger }]}>
					{t("reader.editionNote.failed")}
				</Text>
			</Pressable>
		)
	const text =
		status === "saving"
			? t("reader.editionNote.saving")
			: status === "saved"
				? t("reader.editionNote.saved")
				: t("reader.editionNote.autosave")
	return <Text style={[styles.status, { color: colors.mutedFg }]}>{text}</Text>
}

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
	note: {
		minHeight: 160,
		fontSize: 17,
		lineHeight: 23,
		padding: 12,
		paddingTop: 12,
		borderRadius: 10,
		borderWidth: StyleSheet.hairlineWidth,
		textAlignVertical: "top",
	},
	status: { fontSize: 13, marginTop: 8 },
	fromNote: {
		flexDirection: "row",
		alignItems: "center",
		alignSelf: "flex-start",
		gap: 6,
		marginTop: 16,
	},
	fromNoteText: { fontSize: 15 },
})
