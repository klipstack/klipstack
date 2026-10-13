import { errorDetails } from "@klipstack/sdk"

/** The note as the server has it: its text, and when it was saved (null: never). */
export type SavedNote = { note: string | null; noteUpdatedAt: string | null }

/**
 * Saves of the article note that say which note they replace (`expectedUpdatedAt`), so a note
 * changed elsewhere meanwhile (the web, the share extension) is never written over unseen, as the
 * web's Notebook does. A refused save (`note_changed`) is handed to `onChanged` with the note as
 * it is now, and still fails, so the autosave keeps the text as not saved. Once the reader chose,
 * `replaces` says which note the next save goes over. `at` undefined: not known (a copy kept by an
 * older version), so no check.
 */
export function guardNoteSaves({
	at,
	send,
	onChanged,
}: {
	at: string | null | undefined
	send: (text: string, expected: { expectedUpdatedAt?: string | null }) => Promise<SavedNote>
	onChanged: (now: SavedNote) => void
}) {
	let expected = at
	return {
		async save(text: string): Promise<void> {
			try {
				const saved = await send(
					text,
					expected === undefined ? {} : { expectedUpdatedAt: expected },
				)
				expected = saved.noteUpdatedAt
			} catch (e) {
				const now = errorDetails(e, "note_changed")
				if (now) onChanged(now)
				throw e
			}
		},
		replaces(noteUpdatedAt: string | null) {
			expected = noteUpdatedAt
		},
	}
}
