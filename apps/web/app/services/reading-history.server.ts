import { and, asc, db, documents, eq, isNull, readingCompletions } from "@klipstack/db"

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
