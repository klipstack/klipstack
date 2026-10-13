import { createHash } from "node:crypto"
import {
	and,
	asc,
	type Db,
	db,
	documents,
	eq,
	highlightResurfacing,
	highlights,
	isNull,
	lt,
	type SQL,
	sql,
	type Tx,
} from "@klipstack/db"

/**
 * Highlights brought back to the reader, a few a day: Home's "From your highlights" (and, later, an
 * email digest). `dailyHighlights(userId, day)` picks the day's once and keeps them, so every look
 * at the same day shows the same ones. Its state is `highlight_resurfacing`: the day each highlight
 * was last picked for, and when the reader said it is not useful anymore.
 */
export const RESURFACING = {
	/** Highlights picked a day. */
	perDay: 3,
	/** A highlight younger than this is still fresh in mind: not picked. */
	minAgeDays: 7,
	/** A highlight with a note is this many times as likely to be picked. */
	noteWeight: 3,
	/** Days after being shown until a highlight is as likely as one never shown. */
	restDays: 60,
} as const

const DAY = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000

/** The reader's day (YYYY-MM-DD) at `now` in their time zone. */
export function resurfacingDay(now: Date, timeZone: string): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(now)
}

const daysBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / DAY_MS

export interface ResurfacingCandidate {
	id: string
	documentId: string
	hasNote: boolean
	/** The day it was last picked for, if ever. */
	shownOn: string | null
}

/**
 * How likely a highlight is to be picked on `day`: more with a note, and less the more recently it
 * was shown, back to full after `RESURFACING.restDays`.
 */
export function resurfacingWeight({ hasNote, shownOn }: ResurfacingCandidate, day: string): number {
	const note = hasNote ? RESURFACING.noteWeight : 1
	if (!shownOn) return note
	const rested = Math.min(1, daysBetween(shownOn, day) / RESURFACING.restDays)
	return note * Math.max(rested, 0.001)
}

/** A generator of numbers in [0, 1) that gives the same ones for the same seed (mulberry32). */
function seededRandom(seed: string): () => number {
	let state = createHash("sha256").update(seed).digest().readUInt32LE(0)
	return () => {
		state = (state + 0x6d2b79f5) | 0
		let t = Math.imul(state ^ (state >>> 15), 1 | state)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
	}
}

/**
 * Up to `count` ids, at random weighted by `resurfacingWeight` (Efraimidis–Spirakis: each gets the
 * key r^(1/weight), and the highest keys win), one per article while other articles have some.
 * The same seed and candidates give the same picks.
 */
export function pickHighlights(
	candidates: ResurfacingCandidate[],
	{ day, seed, count = RESURFACING.perDay }: { day: string; seed: string; count?: number },
): string[] {
	const random = seededRandom(seed)
	const ranked = candidates
		.map((c) => ({ ...c, key: random() ** (1 / resurfacingWeight(c, day)) }))
		.sort((a, b) => b.key - a.key)
	const articles = new Set<string>()
	const picks: string[] = []
	for (const c of ranked) {
		if (picks.length === count) break
		if (articles.has(c.documentId)) continue
		articles.add(c.documentId)
		picks.push(c.id)
	}
	for (const c of ranked) {
		if (picks.length === count) break
		if (!picks.includes(c.id)) picks.push(c.id)
	}
	return picks
}

/**
 * Highlights that may come back: the user's, not deleted, still found in their article, the article
 * not in the trash, and not dismissed.
 */
function resurfacable(userId: string): SQL {
	return and(
		eq(highlights.userId, userId),
		eq(documents.userId, userId),
		isNull(highlights.deletedAt),
		eq(highlights.orphaned, false),
		isNull(documents.deletedAt),
		isNull(highlightResurfacing.dismissedAt),
	) as SQL
}

export interface ResurfacedHighlight {
	id: string
	documentId: string
	exact: string
	note: string | null
	color: number
	documentTitle: string | null
	siteName: string | null
	sourceUrl: string
}

/**
 * The user's highlights for `day` (their local day, YYYY-MM-DD), up to `RESURFACING.perDay`. The
 * first call for a day picks them (`pickHighlights`, among those at least `RESURFACING.minAgeDays`
 * old) and records the day on each; later calls return the same ones, less any deleted, dismissed
 * or trashed since. A day whose picks are all gone stays empty. Oldest first.
 */
export async function dailyHighlights(userId: string, day: string): Promise<ResurfacedHighlight[]> {
	if (!DAY.test(day) || Number.isNaN(Date.parse(day))) throw new Error(`Not a day: ${day}`)
	await db.transaction(async (tx) => {
		// Two pages loading at once pick once.
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`resurfacing:${userId}`}))`)
		const [picked] = await tx
			.select({ id: highlightResurfacing.highlightId })
			.from(highlightResurfacing)
			.where(and(eq(highlightResurfacing.userId, userId), eq(highlightResurfacing.shownOn, day)))
			.limit(1)
		if (picked) return
		const candidates = await tx
			.select({
				id: highlights.id,
				documentId: highlights.documentId,
				hasNote: sql<boolean>`coalesce(${highlights.note}, '') <> ''`,
				shownOn: highlightResurfacing.shownOn,
			})
			.from(highlights)
			.innerJoin(documents, eq(documents.id, highlights.documentId))
			.leftJoin(highlightResurfacing, eq(highlightResurfacing.highlightId, highlights.id))
			.where(
				and(
					resurfacable(userId),
					lt(highlights.createdAt, sql`${day}::date - ${RESURFACING.minAgeDays}::int`),
				),
			)
			.orderBy(asc(highlights.id))
		const ids = pickHighlights(candidates, { day, seed: `${userId}:${day}` })
		if (ids.length) await markShown(tx, userId, ids, day)
	})
	return db
		.select({
			id: highlights.id,
			documentId: highlights.documentId,
			exact: highlights.exact,
			note: highlights.note,
			color: highlights.color,
			documentTitle: documents.title,
			siteName: documents.siteName,
			sourceUrl: documents.sourceUrl,
		})
		.from(highlights)
		.innerJoin(documents, eq(documents.id, highlights.documentId))
		.innerJoin(highlightResurfacing, eq(highlightResurfacing.highlightId, highlights.id))
		.where(and(resurfacable(userId), eq(highlightResurfacing.shownOn, day)))
		.orderBy(asc(highlights.createdAt), asc(highlights.id))
}

async function markShown(tx: Db | Tx, userId: string, ids: string[], day: string) {
	await tx
		.insert(highlightResurfacing)
		.values(ids.map((highlightId) => ({ highlightId, userId, shownOn: day })))
		.onConflictDoUpdate({ target: highlightResurfacing.highlightId, set: { shownOn: day } })
}

/**
 * "Not useful anymore" (`at`), or its undo (null). The caller checks the highlight is the user's.
 */
export async function setResurfacingDismissed(
	tx: Db | Tx,
	userId: string,
	highlightId: string,
	at: Date | null,
): Promise<void> {
	await tx
		.insert(highlightResurfacing)
		.values({ highlightId, userId, dismissedAt: at })
		.onConflictDoUpdate({
			target: highlightResurfacing.highlightId,
			set: { dismissedAt: at },
			where: eq(highlightResurfacing.userId, userId),
		})
}
