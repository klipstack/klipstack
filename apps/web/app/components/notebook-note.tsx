import { NOTE_MAX } from "@klipstack/api-contract/names"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAutosaveText } from "~/hooks/use-autosave-text"
import { fitsKeepalive } from "~/lib/keepalive"
import type { LinkTargets } from "~/lib/note-links"
import { NoteField } from "./note-field"
import { NoteStatus } from "./note-status"
import { PostIt, useGrowingFit } from "./post-it"

/** The note as the server has it: its text, and when it was saved (null: never). */
interface Saved {
	note: string
	noteUpdatedAt: string | null
}

/**
 * An article's note in the Notebook, written straight on its post-it, as in the reader's sidebar.
 * Unlike the sidebar, the page may be old: each save says which note it replaces
 * (`expectedUpdatedAt`), so a note written meanwhile elsewhere (the reader, the phone) is never
 * overwritten unseen. When that happens, the writer chooses: the saved note, or theirs.
 */
export function NotebookNote({
	documentId,
	title,
	note,
	noteUpdatedAt,
	linkTargets,
	tilt,
}: Saved & { documentId: string; title: string; linkTargets: LinkTargets; tilt: number }) {
	const { t } = useTranslation("reader")
	// Which note the next save replaces; moved on by every save that lands.
	const expected = useRef(noteUpdatedAt)
	// The editor starts over (`key`) when the writer takes the saved note. Saves of the editor left
	// behind (its flush on unmount) are dropped: they would only be refused again.
	const [start, setStart] = useState({ text: note, rev: 0 })
	const rev = useRef(0)
	const [conflict, setConflict] = useState<Saved | null>(null)

	// Our saves on their way: the page going away sends one without waiting for them.
	const inFlight = useRef(0)

	const send = async (editorRev: number, text: string, keepalive: boolean): Promise<void> => {
		const sentExpected = expected.current
		// Leaving while our own save is on its way: that save moves the note's time, so a guarded
		// one could only be refused. It writes over it instead, as the reader's autosave always does.
		const guarded = !(keepalive && inFlight.current > 1)
		const body = JSON.stringify(
			guarded ? { note: text, expectedUpdatedAt: sentExpected } : { note: text },
		)
		const res = await fetch(`/documents/${documentId}/note`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body,
			keepalive: keepalive && fitsKeepalive(body),
		})
		const answer = (await res.json().catch(() => null)) as {
			noteUpdatedAt?: string | null
			error?: { code?: string; details?: { note: string | null; noteUpdatedAt: string | null } }
		} | null
		if (res.status === 409 && answer?.error?.code === "note_changed" && answer.error.details) {
			if (editorRev !== rev.current) return
			// The writer chose meanwhile to keep theirs: send it again over the note they saw.
			if (expected.current !== sentExpected) return send(editorRev, text, keepalive)
			setConflict({
				note: answer.error.details.note ?? "",
				noteUpdatedAt: answer.error.details.noteUpdatedAt,
			})
			throw new Error("note_changed")
		}
		if (!res.ok) throw new Error(`note save failed: ${res.status}`)
		expected.current = answer?.noteUpdatedAt ?? null
	}

	const save =
		(editorRev: number) =>
		async (text: string, opts: { keepalive: boolean }): Promise<void> => {
			if (editorRev !== rev.current) return
			inFlight.current += 1
			try {
				await send(editorRev, text, opts.keepalive)
			} finally {
				inFlight.current -= 1
			}
		}

	const takeSaved = () => {
		if (!conflict) return
		rev.current += 1
		expected.current = conflict.noteUpdatedAt
		setStart({ text: conflict.note, rev: rev.current })
		setConflict(null)
	}

	return (
		<Editor
			key={start.rev}
			id={`note-${documentId}`}
			documentId={documentId}
			label={t("notebook.noteLabel", { title })}
			initial={start.text}
			save={save(start.rev)}
			linkTargets={linkTargets}
			tilt={tilt}
			conflict={conflict !== null}
			onTheirs={takeSaved}
			onMine={(flush) => {
				if (!conflict) return
				// Write over it, knowingly: the next save replaces the note saved meanwhile.
				expected.current = conflict.noteUpdatedAt
				setConflict(null)
				flush()
			}}
		/>
	)
}

function Editor({
	id,
	documentId,
	label,
	initial,
	save,
	linkTargets,
	tilt,
	conflict,
	onTheirs,
	onMine,
}: {
	id: string
	documentId: string
	label: string
	initial: string
	save: (text: string, opts: { keepalive: boolean }) => Promise<void>
	linkTargets: LinkTargets
	tilt: number
	conflict: boolean
	onTheirs: () => void
	/** Handed this editor's flush, to send the writer's text again. */
	onMine: (flush: () => void) => void
}) {
	const { t } = useTranslation("reader")
	const { value, status, change, flush } = useAutosaveText(initial, save)
	const fit = useGrowingFit(value, id)
	return (
		<div>
			<PostIt
				tilt={tilt}
				fit={fit}
				className="text-[0.9375rem] leading-snug focus-within:ring-2 focus-within:ring-ring"
			>
				<NoteField
					id={id}
					aria-label={label}
					value={value}
					maxLength={NOTE_MAX}
					onChange={change}
					onBlur={flush}
					documentId={documentId}
					linkTargets={linkTargets}
					className="block max-h-96 min-h-12 overflow-y-auto"
				/>
			</PostIt>
			<div className="mt-2 min-h-5 text-xs">
				{conflict ? (
					<span role="alert" className="text-danger">
						{t("notebook.changed.message")}{" "}
						<button
							type="button"
							onMouseDown={(e) => e.preventDefault()}
							onClick={onTheirs}
							className="text-link underline"
						>
							{t("notebook.changed.theirs")}
						</button>
						{" · "}
						<button
							type="button"
							// The caret stays in the note: leaving it would save first, over the note saved elsewhere.
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => onMine(flush)}
							className="text-link underline"
						>
							{t("notebook.changed.mine")}
						</button>
					</span>
				) : (
					<NoteStatus status={status} onRetry={flush} />
				)}
			</div>
		</div>
	)
}
