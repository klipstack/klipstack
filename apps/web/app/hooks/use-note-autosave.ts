import { createNoteAutosave, type NoteSaveStatus } from "@klipstack/sdk/note-autosave"
import { useCallback, useEffect, useMemo, useState } from "react"
import { fitsKeepalive } from "~/lib/keepalive"

/** The article's note, as `useNoteAutosave` keeps it: one text for every editor on the page. */
export type ArticleNote = ReturnType<typeof useNoteAutosave>

/**
 * The article note's text and save status. Saves while typing (debounced), on `flush`, when the page
 * goes away, and when the reader unmounts. The sidebar can come and go; the text lives here.
 */
export function useNoteAutosave(documentId: string, initial: string | null) {
	// A new article starts a new note; loader revalidations must not reset what is being typed.
	const [note, setNote] = useState({ documentId, saved: initial ?? "" })
	const [value, setValue] = useState(note.saved)
	const [status, setStatus] = useState<NoteSaveStatus>("idle")
	if (note.documentId !== documentId) {
		setNote({ documentId, saved: initial ?? "" })
		setValue(initial ?? "")
		setStatus("idle")
	}

	const autosave = useMemo(
		() =>
			createNoteAutosave({
				initial: note.saved,
				onStatus: setStatus,
				save: async (text, { keepalive }) => {
					const body = JSON.stringify({ note: text })
					const res = await fetch(`/documents/${note.documentId}/note`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body,
						keepalive: keepalive && fitsKeepalive(body),
					})
					if (!res.ok) throw new Error(`note save failed: ${res.status}`)
				},
			}),
		[note],
	)

	useEffect(() => {
		const onHide = () => void autosave.flush({ keepalive: true })
		window.addEventListener("pagehide", onHide)
		return () => {
			window.removeEventListener("pagehide", onHide)
			void autosave.flush({ keepalive: true })
			autosave.dispose()
		}
	}, [autosave])

	const change = useCallback(
		(text: string) => {
			setValue(text)
			autosave.change(text)
		},
		[autosave],
	)
	const flush = useCallback(() => void autosave.flush(), [autosave])

	return { value, status, change, flush }
}
