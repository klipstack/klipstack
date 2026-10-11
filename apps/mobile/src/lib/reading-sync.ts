/**
 * Keeps the library's reading state as the web reader does:
 *
 * - An article opened before is opened again at once (`open`, which may start a new reading
 *   cycle). A new one only once the user reads: `engage`, which the reader calls after 10 seconds
 *   on screen, a screen of scrolling or a highlight. A glance keeps it new.
 * - Positions are saved only after that, with the reading cycle, `delay` ms after the last scroll,
 *   when they moved by 0.05 or reached the end (0.98); `flush` saves the exact one on the way out,
 *   and returns the save for whatever must wait for it.
 *
 * A failed save is sent again with the next one, or on the way out.
 */
export function createReadingSync({
	opened,
	position,
	cycle,
	open,
	save,
	delay = 1500,
}: {
	/** The article was opened before. */
	opened: boolean
	/** The saved position and cycle, from the details. */
	position: number
	cycle: number
	open: () => Promise<{ cycle: number }>
	save: (position: number, cycle: number) => Promise<unknown>
	delay?: number
}) {
	let engaged = false
	let current = cycle
	let lastSent = position
	let latest = position
	let timer: ReturnType<typeof setTimeout> | null = null

	const clearTimer = () => {
		if (timer) clearTimeout(timer)
		timer = null
	}

	function engage() {
		if (engaged) return
		engaged = true
		open().then(
			(reading) => {
				current = reading.cycle
			},
			() => {},
		)
	}

	function send(exact: boolean): Promise<unknown> | undefined {
		clearTimer()
		if (!engaged) return
		const moved = exact
			? latest !== lastSent
			: Math.abs(latest - lastSent) >= 0.05 || (latest >= 0.98 && latest !== lastSent)
		if (!moved) return
		const previous = lastSent
		const sent = latest
		lastSent = sent
		return save(sent, current).catch(() => {
			// Not saved: unless a later save went out meanwhile, the next one (or flush) sends it.
			if (lastSent === sent) lastSent = previous
		})
	}

	if (opened) engage()

	return {
		/** Where the reader is now; `movedAScreen` engages. */
		scrolled(at: number, movedAScreen: boolean) {
			latest = at
			if (movedAScreen) engage()
			clearTimer()
			timer = setTimeout(() => send(false), delay)
		},
		engage,
		/** Saves the exact position now, if it moved; the save, which never fails, or nothing. */
		flush: () => send(true),
		get engaged() {
			return engaged
		},
		dispose: clearTimer,
	}
}
