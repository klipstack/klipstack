import { HIGHLIGHT_NOTE_MAX, NOTE_MAX } from "@klipstack/api-contract/names"
import type { Highlight, KlipstackClient } from "@klipstack/sdk"
import { createNoteAutosave, type NoteSaveStatus } from "@klipstack/sdk/note-autosave"
import { useEffect, useRef, useState } from "react"
import {
	Alert,
	Pressable,
	type StyleProp,
	StyleSheet,
	Text,
	type TextStyle,
	View,
} from "react-native"
import {
	LinkArticleButton,
	NoteField,
	type NoteFieldHandle,
	type NoteLinking,
} from "@/components/note-field"
import { notePaper, PostIt, postItText, useGrowingFit } from "@/components/post-it"
import { t } from "@/lib/i18n"
import { fromStored, runs } from "@/lib/note-field"
import { guardNoteSaves, type SavedNote } from "@/lib/note-guard"
import { tiltFor } from "@/lib/post-it"
import type { Colors } from "@/lib/theme"

const ADD_NOTE = t("notebook.note.addYourNote")

/**
 * An article's note in the Notebook, on a large post-it, written on in place: a tap gives the
 * caret. Without a note, a blank post-it to write it on. As on the web, each save says which note it
 * replaces (`expectedUpdatedAt`), so a note written meanwhile elsewhere is never written over
 * unseen: the reader chooses, as in the reader. A note shown here a second time (By topic) is
 * read-only (`editable` false).
 *
 * The list reloading under it brings the note as saved: a note saved elsewhere replaces what shows,
 * unless it is being written in or saved.
 */
export function ArticleNote({
	articleId,
	note,
	noteUpdatedAt,
	editable,
	client,
	linking,
	colors,
	onSaved,
}: {
	articleId: string
	note: string
	noteUpdatedAt: string | null
	editable: boolean
	client: KlipstackClient
	linking: NoteLinking
	colors: Colors
	/** A save landed: the list keeps it, so a reload agrees. Called with the editor's first one. */
	onSaved: (saved: SavedNote) => void
}) {
	// The editor's start: its text and the note it replaces. A new one starts the editor over.
	const [session, setSession] = useState({ text: note, at: noteUpdatedAt, rev: 0 })
	// The note the editor holds, by when it was saved: as it started, or as it last saved.
	const [known, setKnown] = useState(noteUpdatedAt)
	const [editing, setEditing] = useState(false)
	const [status, setStatus] = useState<NoteSaveStatus>("idle")
	const busy = editing || status === "saving" || status === "error"
	// Saved elsewhere since, and not being written in: the note as it is now.
	if (noteUpdatedAt !== known && !busy) {
		setKnown(noteUpdatedAt)
		setSession((s) => ({ text: note, at: noteUpdatedAt, rev: s.rev + 1 }))
	}

	const mounted = useRef(true)
	const asking = useRef(false)
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
		}
	}, [])

	/** Refused: the note changed elsewhere. The reader chooses, as in the reader. */
	const changed = (now: SavedNote, keepMine: () => void, dropMine: () => void) => {
		if (asking.current || !mounted.current) return
		asking.current = true
		Alert.alert(
			t("notebook.note.changed.title"),
			t("notebook.note.changed.message"),
			[
				{
					text: t("notebook.note.changed.theirs"),
					onPress: () => {
						asking.current = false
						dropMine()
						setKnown(now.noteUpdatedAt)
						setStatus("idle")
						setSession((s) => ({ text: now.note ?? "", at: now.noteUpdatedAt, rev: s.rev + 1 }))
						onSaved(now)
					},
				},
				{
					text: t("notebook.note.changed.mine"),
					onPress: () => {
						asking.current = false
						keepMine()
					},
				},
			],
			{ cancelable: false },
		)
	}

	const tilt = tiltFor(articleId)
	if (!editable)
		return (
			<PostIt tilt={tilt} colors={colors} style={styles.large}>
				<NoteText
					note={note}
					linking={linking}
					colors={colors}
					style={[postItText(colors), styles.text]}
				/>
			</PostIt>
		)
	return (
		<ArticleNoteEditor
			key={session.rev}
			articleId={articleId}
			initial={session.text}
			at={session.at}
			client={client}
			linking={linking}
			colors={colors}
			editing={editing}
			setEditing={setEditing}
			status={status}
			setStatus={(s) => mounted.current && setStatus(s)}
			onSaved={(saved) => {
				setKnown(saved.noteUpdatedAt)
				onSaved(saved)
			}}
			onChanged={changed}
		/>
	)
}

/** The article note's editor, from `initial`, saving over the note saved at `at`. */
function ArticleNoteEditor({
	articleId,
	initial,
	at,
	client,
	linking,
	colors,
	editing,
	setEditing,
	status,
	setStatus,
	onSaved,
	onChanged,
}: {
	articleId: string
	initial: string
	at: string | null
	client: KlipstackClient
	linking: NoteLinking
	colors: Colors
	editing: boolean
	setEditing: (editing: boolean) => void
	status: NoteSaveStatus
	setStatus: (status: NoteSaveStatus) => void
	/** Called with the editor's first props: they must not depend on render state. */
	onSaved: (saved: SavedNote) => void
	onChanged: (now: SavedNote, keepMine: () => void, dropMine: () => void) => void
}) {
	const [value, setValue] = useState(initial)
	const field = useRef<NoteFieldHandle>(null)
	const [{ autosave, dropped }] = useState(() => {
		// Set when the reader takes the saved note: this editor's text is not to be saved anymore.
		const dropped = { current: false }
		const guard = guardNoteSaves({
			at,
			send: async (text, expected) => {
				const saved = await client.articles.setNote(articleId, text.trim() ? text : null, expected)
				onSaved(saved)
				return saved
			},
			onChanged: (now) =>
				onChanged(
					now,
					() => {
						guard.replaces(now.noteUpdatedAt)
						void save.flush()
					},
					() => {
						dropped.current = true
					},
				),
		})
		const save = createNoteAutosave({ initial, onStatus: setStatus, save: guard.save })
		return { autosave: save, dropped }
	})
	// Out of view (the list recycles its rows) or started over: what was typed is saved, unless the
	// reader took the saved note instead.
	useEffect(
		() => () => {
			if (!dropped.current) void autosave.flush()
			autosave.dispose()
		},
		[autosave, dropped],
	)

	return (
		<View>
			<PostIt
				tilt={tiltFor(articleId)}
				blank={!value && !editing}
				colors={colors}
				style={styles.large}
			>
				{editing ? (
					<NoteField
						ref={field}
						accessibilityLabel={t("notebook.note.articleNote")}
						value={value}
						onChange={(text) => {
							setValue(text)
							autosave.change(text)
						}}
						onBlur={() => {
							setEditing(false)
							void autosave.flush()
						}}
						linking={linking}
						maxLength={NOTE_MAX}
						placeholder={ADD_NOTE}
						placeholderColor={colors.note.placeholder}
						autoFocus
						scrollEnabled={false}
						colors={colors}
						style={[postItText(colors), styles.text, styles.field]}
					/>
				) : (
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={value ? t("notebook.note.articleNote") : ADD_NOTE}
						accessibilityHint={value ? t("notebook.note.editsHint") : undefined}
						onPress={() => setEditing(true)}
						style={styles.tap}
					>
						<Text
							style={[
								postItText(colors),
								styles.text,
								!value && { color: colors.note.placeholder },
							]}
						>
							{value ? <NoteRuns note={value} linking={linking} colors={colors} /> : ADD_NOTE}
						</Text>
					</Pressable>
				)}
			</PostIt>
			{editing ? (
				<View style={styles.tools}>
					<LinkArticleButton field={field} colors={colors} />
				</View>
			) : null}
			<SaveStatus status={status} retry={() => void autosave.flush()} colors={colors} />
		</View>
	)
}

/**
 * A highlight's note on a small post-it in its color, written on in place: a tap gives the caret.
 * `editing` with no note: its blank post-it, out to write one (the card's Add Note).
 */
export function HighlightNote({
	highlight,
	editing,
	setEditing,
	client,
	linking,
	colors,
	onSaved,
}: {
	highlight: Pick<Highlight, "id" | "note" | "color">
	editing: boolean
	setEditing: (editing: boolean) => void
	client: KlipstackClient
	linking: NoteLinking
	colors: Colors
	/** Called with the first props: it must not depend on render state. */
	onSaved: (note: string | null) => void
}) {
	const [value, setValue] = useState(highlight.note ?? "")
	const field = useRef<NoteFieldHandle>(null)
	const [status, setStatus] = useState<NoteSaveStatus>("idle")
	const [autosave] = useState(() =>
		createNoteAutosave({
			initial: highlight.note ?? "",
			onStatus: setStatus,
			save: async (text) => {
				const note = text.trim() ? text : null
				await client.highlights.update(highlight.id, { note })
				onSaved(note)
			},
		}),
	)
	useEffect(
		() => () => {
			void autosave.flush()
			autosave.dispose()
		},
		[autosave],
	)
	// Saved elsewhere since, and not being written in or saved: the note as it is now.
	const [seen, setSeen] = useState(highlight.note)
	if (highlight.note !== seen && !editing && status !== "saving" && status !== "error") {
		setSeen(highlight.note)
		setValue(highlight.note ?? "")
	}

	const fit = useGrowingFit(value, highlight.id)
	if (!value && !editing) return null
	return (
		<View style={styles.small}>
			<PostIt
				variant="compact"
				fit={fit || ADD_NOTE}
				tilt={tiltFor(highlight.id)}
				color={highlight.color}
				blank={!value && !editing}
				colors={colors}
			>
				{editing ? (
					<NoteField
						ref={field}
						accessibilityLabel={t("notebook.note.highlightNote")}
						value={value}
						onChange={(text) => {
							setValue(text)
							autosave.change(text)
						}}
						onBlur={() => {
							setEditing(false)
							void autosave.flush()
						}}
						linking={linking}
						maxLength={HIGHLIGHT_NOTE_MAX}
						placeholder={t("notebook.note.placeholder")}
						placeholderColor={notePaper(colors, highlight.color).placeholder}
						autoFocus
						scrollEnabled={false}
						colors={colors}
						style={[postItText(colors, "compact", highlight.color), styles.field]}
					/>
				) : (
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={t("notebook.note.highlightNote")}
						accessibilityHint={t("notebook.note.editsHint")}
						onPress={() => setEditing(true)}
					>
						<Text style={postItText(colors, "compact", highlight.color)}>
							<NoteRuns note={value} linking={linking} colors={colors} />
						</Text>
					</Pressable>
				)}
			</PostIt>
			{editing ? (
				<View style={styles.tools}>
					<LinkArticleButton field={field} compact colors={colors} />
				</View>
			) : null}
			<SaveStatus status={status} retry={() => void autosave.flush()} colors={colors} />
		</View>
	)
}

/** A note as written: links as their titles, which open their articles, as in the reader. */
function NoteText({
	note,
	linking,
	colors,
	style,
}: {
	note: string
	linking: NoteLinking
	colors: Colors
	style: StyleProp<TextStyle>
}) {
	return (
		<Text style={style}>
			<NoteRuns note={note} linking={linking} colors={colors} />
		</Text>
	)
}

/**
 * The runs of a note's text, inside a `Text`: a link to an article still there opens it; one in the
 * trash is struck through, and one gone is greyed, as the reader's note field shows them.
 */
function NoteRuns({
	note,
	linking,
	colors,
}: {
	note: string
	linking: NoteLinking
	colors: Colors
}) {
	return runs(fromStored(note)).map((run) => {
		if (!run.link) return run.text
		const { id } = run.link
		const status = linking.status(id)
		return (
			<Text
				key={run.start}
				accessibilityRole="link"
				onPress={status === "ok" ? () => linking.open(id) : undefined}
				style={
					status === "trash"
						? { color: colors.mutedFg, textDecorationLine: "line-through" }
						: {
								color: status === "ok" ? colors.accent : colors.mutedFg,
								textDecorationLine: "underline",
							}
				}
			>
				{run.text}
			</Text>
		)
	})
}

function SaveStatus({
	status,
	retry,
	colors,
}: {
	status: NoteSaveStatus
	retry: () => void
	colors: Colors
}) {
	if (status === "error")
		return (
			<Pressable accessibilityRole="button" onPress={retry}>
				<Text style={[styles.status, { color: colors.danger }]}>{t("notebook.note.notSaved")}</Text>
			</Pressable>
		)
	if (status === "saving")
		return (
			<Text style={[styles.status, { color: colors.mutedFg }]}>{t("notebook.note.saving")}</Text>
		)
	return null
}

const styles = StyleSheet.create({
	// As wide as the column, room above for its tape.
	large: { alignSelf: "stretch", minHeight: 120, marginTop: 12, marginHorizontal: 4 },
	small: { alignSelf: "flex-start", marginTop: 12 },
	text: { fontSize: 19, lineHeight: 27 },
	// A text field's own padding off: the words stay where the text's were.
	field: { padding: 0, paddingTop: 0 },
	tap: { flexGrow: 1 },
	tools: { marginTop: 10 },
	status: { fontSize: 13, marginTop: 8 },
})
