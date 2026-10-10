/**
 * Finishing on the way out: a reader who reached the end of an article and then leaves it has
 * finished it, unless they got there faster than anyone reads. The web reader and the mobile app
 * use the same rule.
 */

/** How many times faster than the article's reading time still counts as reading it. */
export const FASTEST_READING = 3

/**
 * Seconds on the page, in this visit, before reaching the end counts as having read to it: the
 * part of the article left when the reader opened it, at three times the usual speed.
 * `openedAt` is the position the reader opened at (0–1). Without a reading time, a minute.
 */
export function secondsToFinish(readingMinutes: number | null, openedAt: number): number {
	const minutes = readingMinutes && readingMinutes > 0 ? readingMinutes : 1
	const left = Math.min(1, Math.max(0, 1 - (Number.isFinite(openedAt) ? openedAt : 0)))
	return Math.round((left * minutes * 60) / FASTEST_READING)
}

/** What the end of the article offers. */
export type EndState =
	/** Finished before: nothing happens on the way out. */
	| "finished"
	/** Leaving finishes it (and archives it, if it is in the library). */
	| "finishing"
	/** The reader chose to keep it as it is this time; leaving changes nothing. */
	| "kept"
	/** Too soon to tell it was read: leaving changes nothing; a button finishes it. */
	| "early"

export function endState({
	finished,
	reachedEnd,
	seconds,
	needed,
	kept,
}: {
	finished: boolean
	/** The end of the article came into view during this visit. */
	reachedEnd: boolean
	/** Seconds on the page (in view) during this visit. */
	seconds: number
	/** `secondsToFinish` for this visit. */
	needed: number
	kept: boolean
}): EndState {
	if (finished) return "finished"
	if (kept) return "kept"
	return reachedEnd && seconds >= needed ? "finishing" : "early"
}
