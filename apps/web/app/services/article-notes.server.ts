import {
	and,
	db,
	desc,
	documents,
	eq,
	isNotNull,
	isNull,
	searchQuery,
	sql,
	textSearchVector,
} from "@klipstack/db"
import { type ModificationRange, modificationRange } from "./annotation-dates.server"

export interface ArticleNoteCursor {
	updatedAt: string
	id: string
}

/** Whole-article notes, including cleared notes, most recently edited first. */
export async function listArticleNotes({
	userId,
	documentId,
	q,
	updatedSince,
	updatedBefore,
	cursor,
	limit = 50,
}: ModificationRange & {
	userId: string
	documentId?: string
	q?: string
	cursor?: ArticleNoteCursor | null
	limit?: number
}) {
	const query = q?.replaceAll("\u0000", "").trim().slice(0, 200)
	const rows = await db
		.select({
			id: documents.id,
			note: documents.note,
			updatedAt: sql<string>`to_char(${documents.noteUpdatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
			article: {
				id: documents.id,
				title: documents.title,
				author: documents.author,
				site: documents.siteName,
				url: documents.sourceUrl,
			},
		})
		.from(documents)
		.where(
			and(
				eq(documents.userId, userId),
				isNull(documents.deletedAt),
				isNotNull(documents.noteUpdatedAt),
				documentId ? eq(documents.id, documentId) : undefined,
				modificationRange(documents.noteUpdatedAt, { updatedSince, updatedBefore }),
				query
					? sql`${textSearchVector(sql`${documents.note}`, sql`null::text`)} @@ ${searchQuery(query)}`
					: undefined,
				cursor
					? sql`(${documents.noteUpdatedAt}, ${documents.id}) < (${cursor.updatedAt}::timestamptz, ${cursor.id}::uuid)`
					: undefined,
			),
		)
		.orderBy(desc(documents.noteUpdatedAt), desc(documents.id))
		.limit(limit + 1)
	const items = rows.slice(0, limit)
	const last = items.at(-1)
	return {
		items,
		nextCursor: rows.length > limit && last ? { updatedAt: last.updatedAt, id: last.id } : null,
	}
}
