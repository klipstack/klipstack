import {
	and,
	asc,
	db,
	documents,
	eq,
	inArray,
	isNull,
	lte,
	readingCompletions,
	sql,
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
const READ_SOURCES = ["manual", "progress", "legacy"] as const

/**
 * What the reader finished in the past week: today and the 6 days before, as days in their time
 * zone (a name, `isTimeZone`). Articles, not completions: one read twice counts once. Null when
 * there is none; `title` only when there is one.
 */
export async function finishedLately(
	userId: string,
	{ now = new Date(), timeZone }: { now?: Date; timeZone: string },
): Promise<{ count: number; title: string | null } | null> {
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
