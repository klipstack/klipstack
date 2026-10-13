import { fitsIn, homeShelves } from "~/lib/home-shelves"

/**
 * The landing page's walkthrough: one sample essay (copy in `home.demo`) followed from Home to the
 * notebook and an edition, and the few saves around it (copy in `home.choose.items`).
 */
export const PARAGRAPHS = [
	["s1", "s2", "s3"],
	["s4", "s5", "s6"],
	["s7", "s8"],
] as const

export type SentenceId = (typeof PARAGRAPHS)[number][number]

export const SENTENCES: readonly SentenceId[] = PARAGRAPHS.flat()

/** The highlighted sentences. */
export type Marks = Partial<Record<SentenceId, true>>

export const INITIAL_MARKS: Marks = { s5: true, s8: true }

/** The sentence that carries the sample margin note, while it is highlighted. */
export const NOTED: SentenceId = "s5"

/** An edition quotes at most this many highlights of one article, as the edition editor does. */
export const EDITION_HIGHLIGHTS_MAX = 3

/** Which of Home's shelves a save sits on. */
export type Shelf = "reading" | "recent" | "rediscover"

export interface SampleSave {
	id: "walk" | "essay" | "benches" | "bread" | "cards"
	shelf: Shelf
	/** Minutes left to read: all of it, unless started. */
	minutesLeft: number
	/** Read so far, 0 to 1. */
	progress: number
}

/** The sample essay's length, in minutes. */
export const ESSAY_MINUTES = 4

/** The sample library, in Home's order within each shelf. `essay` is the article that follows. */
export const SAVES: readonly SampleSave[] = [
	{ id: "walk", shelf: "reading", minutesLeft: 9, progress: 0.5 },
	{ id: "essay", shelf: "recent", minutesLeft: ESSAY_MINUTES, progress: 0 },
	{ id: "benches", shelf: "recent", minutesLeft: 12, progress: 0 },
	{ id: "bread", shelf: "rediscover", minutesLeft: 7, progress: 0 },
	{ id: "cards", shelf: "rediscover", minutesLeft: 26, progress: 0 },
]

/** A date for the sample: every save counts as saved after Home's "recent" cut-off. */
const SAVED = new Date(0)

/**
 * Home's shelves for the time chosen (null: any), filled by Home's own rules (`homeShelves`).
 * `pickUp`: nothing started fits, so the article read last stays, as where the reader left off.
 */
export function sampleShelves(minutes: number | null) {
	const timed = (shelf: Shelf) =>
		SAVES.filter((s) => s.shelf === shelf).map((s) => ({ ...s, createdAt: SAVED }))
	const shelves = homeShelves(
		{
			reading: timed("reading"),
			recent: timed("recent"),
			rediscover: timed("rediscover"),
			recentSince: SAVED,
		},
		minutes,
	)
	const last = shelves.reading[0]
	return { ...shelves, pickUp: last !== undefined && !fitsIn(last, minutes) }
}

/** The highlight color (`--hl` in app.css), and its solid form for lines. */
export const HL_BG = "marker"
export const HL_SOLID_BORDER = "border-(--hl-solid)"
