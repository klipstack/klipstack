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

/**
 * Well-known books by their length in words (English editions, roughly), shortest first: a total
 * of words read reads better as a book it outgrew. The web and the iPhone app name them
 * (`library:stats.books`, `library.reading.books`).
 */
const BOOKS = [
	["lottery", 3_400],
	["wallpaper", 6_000],
	["littlePrince", 17_000],
	["metamorphosis", 22_000],
	["oldMan", 27_000],
	["gatsby", 47_000],
	["frankenstein", 75_000],
	["pride", 122_000],
	["mobyDick", 206_000],
	["warAndPeace", 587_000],
] as const

export type Book = (typeof BOOKS)[number][0]

/** The longest book shorter than `words`, or null below the shortest. */
export function longerThan(words: number): Book | null {
	return BOOKS.findLast(([, length]) => words > length)?.[0] ?? null
}
