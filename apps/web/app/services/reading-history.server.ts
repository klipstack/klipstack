import {
	and,
	asc,
	db,
	desc,
	documents,
	documentTopics,
	eq,
	inArray,
	isNull,
	lte,
	readingCompletions,
	sql,
	topics,
} from "@klipstack/db"

/** History for live articles owned by this reader. Trash never enters rediscovery or exports. */
export async function listReadingHistory(userId: string, documentId?: string) {
	return db
		.select({
			id: readingCompletions.id,
			documentId: readingCompletions.documentId,
			completedAt: readingCompletions.completedAt,
			source: readingCompletions.source,
		})
		.from(readingCompletions)
		.innerJoin(documents, eq(documents.id, readingCompletions.documentId))
		.where(
			and(
				eq(readingCompletions.userId, userId),
				eq(documents.userId, userId),
				isNull(documents.deletedAt),
				documentId ? eq(documents.id, documentId) : undefined,
			),
		)
		.orderBy(asc(readingCompletions.completedAt), asc(readingCompletions.id))
}

export type ReadingHistory = Awaited<ReturnType<typeof listReadingHistory>>

/**
 * Completions that are reading. Bulk finishes are tidying up; sources added later (an importer)
 * stay out until they are listed here.
 */
const READ_SOURCES = ["manual", "progress", "legacy", "listened"] as const

/**
 * What the reader finished in the past week: today and the 6 days before, as days in their time
 * zone (a name, `isTimeZone`). Articles, not completions: one read twice counts once. Null when
 * there is none; `title` only when there is one.
 */
export async function finishedLately(
	userId: string,
	{ now = new Date(), timeZone }: { now?: Date; timeZone: string },
): Promise<{ count: number; title: string | null } | null> {
	return inZone(timeZone, (zone) => finishedSince(userId, now, zone))
}

/** Runs a query by the reader's days, or by UTC days when this database doesn't know their zone. */
async function inZone<T>(timeZone: string, run: (zone: string) => Promise<T>): Promise<T> {
	try {
		return await run(timeZone)
	} catch (error) {
		// A zone the browser knows but this database's time zone data doesn't (22023).
		if (timeZone === "UTC" || (error as { cause?: { code?: string } }).cause?.code !== "22023")
			throw error
		return run("UTC")
	}
}

async function finishedSince(userId: string, now: Date, timeZone: string) {
	const since = sql`(date_trunc('day', ${now.toISOString()}::timestamptz at time zone ${timeZone}) - interval '6 days') at time zone ${timeZone}`
	const [row] = await db
		.select({
			count: sql<number>`count(distinct ${documents.id})::int`,
			title: sql<string | null>`(array_agg(${documents.title}))[1]`,
		})
		.from(readingCompletions)
		.innerJoin(documents, eq(documents.id, readingCompletions.documentId))
		.where(
			and(
				eq(readingCompletions.userId, userId),
				eq(documents.userId, userId),
				isNull(documents.deletedAt),
				inArray(readingCompletions.source, READ_SOURCES),
				sql`${readingCompletions.completedAt} >= ${since}`,
				lte(readingCompletions.completedAt, now),
			),
		)
	if (!row?.count) return null
	return { count: row.count, title: row.count === 1 ? row.title : null }
}

export interface ReadTotals {
	articles: number
	words: number
	/** Estimated from each article's length, not timed. */
	minutes: number
}

export interface ReadingStats {
	/** The reader's day, `YYYY-MM-DD`, as every day here is. */
	today: string
	/** The past 7 days (as Home's line counts them), this month and this year, so far. */
	totals: { week: ReadTotals; month: ReadTotals; year: ReadTotals }
	/** Articles finished each day since `from`, a Monday a year of whole weeks ago. Only days with any. */
	days: Record<string, number>
	from: string
	/** The last 12 weeks (from Monday) or months, the current one last. */
	periods: (ReadTotals & { start: string })[]
	/** One of `periods`, with what was finished in it and the topics it was in, most first. */
	selected: {
		start: string
		/** Its last day. */
		end: string
		articles: {
			id: string
			title: string | null
			siteName: string | null
			words: number
			minutes: number
			/** The last day it was finished in the period. */
			day: string
		}[]
		topics: { id: string; name: string; articles: number }[]
	}
}

export const STATS_PERIODS = 12
const TOP_TOPICS = 5

/**
 * What the reader finished, for the Your reading page: totals, a year by day, and weeks or months
 * to choose from. Counted as Home's line counts: articles, not completions, without bulk finishes
 * or the trash. Days are the reader's (a zone name, `isTimeZone`). `start` chooses a period by its
 * first day; one not shown is the current one. Topics only with `topics`, when they are in use.
 */
export async function readingStats(
	userId: string,
	opts: {
		now?: Date
		timeZone: string
		by: "week" | "month"
		start?: string | null
		topics?: boolean
	},
): Promise<ReadingStats> {
	return inZone(opts.timeZone, (zone) => statsIn(userId, { ...opts, timeZone: zone }))
}

async function statsIn(
	userId: string,
	{
		now = new Date(),
		timeZone,
		by,
		start,
		topics: withTopics = false,
	}: Parameters<typeof readingStats>[1],
): Promise<ReadingStats> {
	const today = await dayIn(now, timeZone)
	const week = addDays(today, -((weekday(today) + 6) % 7))
	const month = `${today.slice(0, 7)}-01`
	const from = addDays(week, -52 * 7)
	const periods = Array.from({ length: STATS_PERIODS }, (_, i) =>
		by === "week"
			? addDays(week, -7 * (STATS_PERIODS - 1 - i))
			: addMonths(month, -(STATS_PERIODS - 1 - i)),
	)
	const since = [from, periods[0]!].sort()[0]!
	const rows = await finishedDays(userId, { now, timeZone, since })

	const totals = (first: string, last = today) =>
		sum(rows.filter((r) => r.day >= first && r.day <= last))
	const endOf = (first: string) =>
		by === "week" ? addDays(first, 6) : addDays(addMonths(first, 1), -1)
	const days: Record<string, number> = {}
	const byDay = new Map<string, Set<string>>()
	for (const r of rows)
		if (r.day >= from) byDay.set(r.day, (byDay.get(r.day) ?? new Set()).add(r.id))
	for (const [day, ids] of byDay) days[day] = ids.size
	const chosen = start && periods.includes(start) ? start : periods.at(-1)!
	const end = endOf(chosen)
	const inChosen = new Map<string, (typeof rows)[number]>()
	// Rows come by day: each article where it was last finished (a Map keeps a key where it was first
	// set, so it is taken out first).
	for (const row of rows) {
		if (row.day < chosen || row.day > end) continue
		inChosen.delete(row.id)
		inChosen.set(row.id, row)
	}
	const articles = [...inChosen.values()]
		.reverse()
		.map(({ id, title, siteName, words, minutes, day }) => ({
			id,
			title,
			siteName,
			words,
			minutes,
			day,
		}))

	return {
		today,
		totals: {
			week: totals(addDays(today, -6)),
			month: totals(month),
			year: totals(`${today.slice(0, 4)}-01-01`),
		},
		days,
		from,
		periods: periods.map((first) => ({ start: first, ...totals(first, endOf(first)) })),
		selected: {
			start: chosen,
			end,
			articles,
			topics: withTopics ? await topicsOf(userId, [...inChosen.keys()]) : [],
		},
	}
}

async function dayIn(now: Date, timeZone: string): Promise<string> {
	const result = await db.execute<{ day: string }>(
		sql`select (${now.toISOString()}::timestamptz at time zone ${timeZone})::date::text as day`,
	)
	return result.rows[0]!.day
}

/** Each finish since a day, until now, with the reader's day it fell on; by day, then time. */
async function finishedDays(
	userId: string,
	{ now, timeZone, since }: { now: Date; timeZone: string; since: string },
) {
	const day = sql<string>`(${readingCompletions.completedAt} at time zone ${timeZone})::date::text`
	return db
		.select({
			id: documents.id,
			title: documents.title,
			siteName: documents.siteName,
			words: sql<number>`coalesce(${documents.wordCount}, 0)`,
			minutes: sql<number>`coalesce(${documents.readingMinutes}, 0)`,
			day,
		})
		.from(readingCompletions)
		.innerJoin(documents, eq(documents.id, readingCompletions.documentId))
		.where(
			and(
				eq(readingCompletions.userId, userId),
				eq(documents.userId, userId),
				isNull(documents.deletedAt),
				inArray(readingCompletions.source, READ_SOURCES),
				sql`${readingCompletions.completedAt} >= (${since}::date::timestamp at time zone ${timeZone})`,
				lte(readingCompletions.completedAt, now),
			),
		)
		.orderBy(asc(readingCompletions.completedAt), asc(readingCompletions.id))
}

/** Articles once each, however often they were finished in the rows. */
function sum(rows: { id: string; words: number; minutes: number }[]): ReadTotals {
	const once = new Map(rows.map((r) => [r.id, r]))
	let words = 0
	let minutes = 0
	for (const r of once.values()) {
		words += r.words
		minutes += r.minutes
	}
	return { articles: once.size, words, minutes }
}

async function topicsOf(userId: string, documentIds: string[]) {
	if (!documentIds.length) return []
	const articles = sql<number>`count(distinct ${documentTopics.documentId})::int`
	return db
		.select({ id: topics.id, name: topics.name, articles })
		.from(documentTopics)
		.innerJoin(topics, eq(topics.id, documentTopics.topicId))
		.where(
			and(
				inArray(documentTopics.documentId, documentIds),
				eq(topics.userId, userId),
				eq(topics.status, "active"),
				eq(documentTopics.level, "applied"),
				isNull(documentTopics.refusedAt),
			),
		)
		.groupBy(topics.id)
		.orderBy(desc(articles), asc(topics.name))
		.limit(TOP_TOPICS)
}

/** Calendar arithmetic on `YYYY-MM-DD` days, which have no zone. */
const asDate = (day: string) => new Date(`${day}T00:00:00Z`)
const addDays = (day: string, n: number) =>
	new Date(asDate(day).getTime() + n * 86_400_000).toISOString().slice(0, 10)
const weekday = (day: string) => asDate(day).getUTCDay()
function addMonths(first: string, n: number) {
	const d = asDate(first)
	d.setUTCMonth(d.getUTCMonth() + n)
	return d.toISOString().slice(0, 10)
}
