export type NoteSaveStatus = "idle" | "saving" | "saved" | "error"

type Save = (text: string, opts: { keepalive: boolean }) => Promise<void>

/**
 * Autosave for the article note. Saves `delay` ms after the last change, or at once on flush.
 * One save runs at a time; changes made meanwhile go out when it returns. Unchanged text is not sent.
 * Web and mobile share this one.
 */
export function createNoteAutosave({
	initial,
	save,
	onStatus,
	delay = 800,
}: {
	initial: string
	save: Save
	onStatus: (status: NoteSaveStatus) => void
	delay?: number
}) {
	let saved = initial
	let latest = initial
	let timer: ReturnType<typeof setTimeout> | null = null
	let inFlight = false
	let failed = false

	const clearTimer = () => {
		if (timer) clearTimeout(timer)
		timer = null
	}

	async function send(keepalive: boolean) {
		clearTimer()
		if (latest === saved) return
		// The page is going away: don't wait for the running save, it may never finish.
		if (inFlight && !keepalive) return
		const text = latest
		inFlight = true
		onStatus("saving")
		try {
			await save(text, { keepalive })
			saved = text
			failed = false
		} catch {
			failed = true
		} finally {
			inFlight = false
		}
		if (failed) return onStatus("error")
		if (latest !== saved) return send(false)
		onStatus("saved")
	}

	return {
		change(text: string) {
			latest = text
			clearTimer()
			timer = setTimeout(() => void send(false), delay)
		},
		/** Save now. `keepalive` lets the request outlive the page (pagehide). */
		flush(opts: { keepalive?: boolean } = {}) {
			return send(opts.keepalive ?? false)
		},
		/** True while typed text is not on the server yet. */
		get dirty() {
			return latest !== saved
		},
		get failed() {
			return failed
		},
		dispose: clearTimer,
	}
}
