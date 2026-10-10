import { createNoteAutosave, type NoteSaveStatus } from "@klipstack/sdk/note-autosave"
import { createContext, useCallback, useContext, useEffect, useState } from "react"

type Save = (text: string, opts: { keepalive: boolean }) => Promise<void>
type Flush = () => Promise<void>

/**
 * The fields of one form that save themselves. Before an action that reads what they saved
 * (publishing, previewing), `flushAll` sends what is still waiting.
 */
export class AutosaveGroup {
	private flushes = new Set<Flush>()
	add(flush: Flush) {
		this.flushes.add(flush)
		return () => void this.flushes.delete(flush)
	}
	async flushAll() {
		await Promise.all([...this.flushes].map((flush) => flush()))
	}
}

export const AutosaveGroupContext = createContext<AutosaveGroup | null>(null)

/**
 * A text field that saves itself, by the article note's rules (`createNoteAutosave`): after a
 * pause in typing, on `flush` (blur), and when the page goes away. Reads `initial` and `save`
 * once: give the field a new `key` when either should change (the text was replaced elsewhere,
 * the field saves somewhere else).
 */
export function useAutosaveText(initial: string, save: Save) {
	const [value, setValue] = useState(initial)
	const [status, setStatus] = useState<NoteSaveStatus>("idle")
	const [autosave] = useState(() => createNoteAutosave({ initial, onStatus: setStatus, save }))

	const group = useContext(AutosaveGroupContext)
	useEffect(() => group?.add(() => autosave.flush()), [group, autosave])

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
