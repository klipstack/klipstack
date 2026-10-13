import {
	and,
	db,
	desc,
	documents,
	documentTags,
	eq,
	isNotNull,
	isNull,
	type SQL,
	sql,
	tags,
} from "@klipstack/db"
import { noteMatch } from "./annotation-search.server"
import { articleHasTag } from "./tags.server"

/**
 * The Notebook: every article note the user wrote, most recently edited first, with its article's
 * title, site and cover. Searched with the search page's notes match (`noteMatch`), narrowed by a
 * tag. Nothing of an article in the trash.
 */

export const NOTEBOOK_PAGE_SIZE = 30
/** Tags offered as filters: the ones with the most notes. */
export const NOTEBOOK_TAGS_SHOWN = 12

export interface NotebookNote {
	documentId: string
	/** The title, or the address without one. */
	title: string
	siteName: string | null
	/** The lead image, as the library's cards show it; null without one. */
	image: string | null
	note: string
	/** When the note was last saved; what a save in place sends back as `expectedUpdatedAt`. */
	noteUpdatedAt: Date | null
	/** Their names, by name. */
	tags: string[]
}

export interface NotebookCursor {
	at: string
	id: string
}

/**
 * When a note was last written: its save time, or for a note that never went through a save (an
 * import), when the article was saved. To the microsecond, for the cursor.
 */
const writtenAt = sql`coalesce(${documents.noteUpdatedAt}, ${documents.createdAt})`
const writtenAtExact = sql<string>`to_char(${writtenAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

// Spelled out: in a select list Drizzle leaves the outer column unqualified, and inside the
// subquery `id` would be the tag's.
const tagNames = sql<
	string[]
>`coalesce((select array_agg(t.name order by lower(t.name), t.name) from document_tags dt inner join tags t on t.id = dt.tag_id where dt.document_id = "documents"."id"), '{}')`

const hasNote = (userId: string) =>
	and(eq(documents.userId, userId), isNull(documents.deletedAt), isNotNull(documents.note)) as SQL

/**
 * One page of notes. With `q`, only notes with its words (a query of operators alone finds none,
 * as on the search page); with `tag`, only articles with that tag, whatever its case.
 */
export async function listNotebook({
	userId,
	q = "",
	tag = null,
	cursor = null,
	limit = NOTEBOOK_PAGE_SIZE,
	timeZone,
}: {
	userId: string
	q?: string
	tag?: string | null
	cursor?: NotebookCursor | null
	limit?: number
	timeZone?: string
}): Promise<{ items: NotebookNote[]; nextCursor: NotebookCursor | null }> {
	let words: SQL | undefined
	if (q.trim()) {
		const match = noteMatch(userId, q, timeZone)
		if (!match) return { items: [], nextCursor: null }
		words = match.where
	}
	const rows = await db
		.select({
			documentId: documents.id,
			title: sql<string>`coalesce(nullif(${documents.title}, ''), ${documents.sourceUrl})`,
			siteName: documents.siteName,
			leadImageUrl: documents.leadImageUrl,
			leadImageAssetId: documents.leadImageAssetId,
			note: sql<string>`${documents.note}`,
			noteUpdatedAt: documents.noteUpdatedAt,
			tags: tagNames,
			at: writtenAtExact,
		})
		.from(documents)
		.where(
			and(
				hasNote(userId),
				words,
				tag ? articleHasTag(tag) : undefined,
				cursor
					? sql`(${writtenAt}, ${documents.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
					: undefined,
			),
		)
		.orderBy(desc(writtenAt), desc(documents.id))
		.limit(limit + 1)
	const page = rows.slice(0, limit)
	const last = page.at(-1)
	return {
		items: page.map(({ leadImageUrl, leadImageAssetId, at: _at, ...n }) => ({
			...n,
			image: leadImageAssetId ? `/assets/${leadImageAssetId}` : leadImageUrl,
		})),
		nextCursor: rows.length > limit && last ? { at: last.at, id: last.documentId } : null,
	}
}

/** The tags of articles with notes, most notes first, then by name; with how many notes each. */
export async function notebookTags(
	userId: string,
	limit = NOTEBOOK_TAGS_SHOWN,
): Promise<Array<{ name: string; notes: number }>> {
	const notes = sql<number>`count(*)::int`
	return db
		.select({ name: tags.name, notes })
		.from(tags)
		.innerJoin(documentTags, eq(documentTags.tagId, tags.id))
		.innerJoin(documents, eq(documents.id, documentTags.documentId))
		.where(and(eq(tags.userId, userId), hasNote(userId)))
		.groupBy(tags.id, tags.name)
		.orderBy(desc(notes), sql`lower(${tags.name})`, tags.name)
		.limit(limit)
}

/** Whether the user has written any article note at all: the empty page's invitation. */
export async function hasAnyNote(userId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: documents.id })
		.from(documents)
		.where(hasNote(userId))
		.limit(1)
	return Boolean(row)
}
