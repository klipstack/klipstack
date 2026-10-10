import {
	and,
	db,
	desc,
	documentLinks,
	documentOutlinks,
	documents,
	eq,
	exists,
	highlights,
	inArray,
	isNull,
	lt,
	ne,
	or,
	type SQL,
	sql,
	type Tx,
} from "@klipstack/db"
import { alias } from "drizzle-orm/pg-core"
import { extractLinkIds, type LinkTargets } from "~/lib/note-links"

/** Most link rows a single note can hold; a note linking more than this is not a note. */
const LINKS_PER_NOTE = 100
/** Most backlinks the reader shows. */
export const BACKLINKS_MAX = 100
/** Most articles each list of content links holds. */
export const CONTENT_LINKS_MAX = 100
/** Ids per target lookup. Notes cap the targets there can be (a note is at most 100,000 characters). */
const TARGET_LOOKUP_CHUNK = 500

export interface Backlink {
	documentId: string
	title: string | null
	sourceUrl: string
	highlightId: string | null
	exact: string | null
}

/** An article at the other end of a link found in an article's content. */
export interface ContentLink {
	documentId: string
	title: string | null
	sourceUrl: string
}

export interface ContentLinks {
	/** Library articles this article's content links to. */
	to: ContentLink[]
	/** Library articles whose content links to this one. */
	from: ContentLink[]
}

const sourceArticle = alias(documents, "link_source")
const targetArticle = alias(documents, "link_target")

/** Live note links, restricted to this user's articles at both ends. */
function noteLinksQuery(userId: string, condition?: SQL) {
	return db
		.select({
			id: documentLinks.id,
			source: {
				id: sourceArticle.id,
				title: sourceArticle.title,
				url: sourceArticle.sourceUrl,
			},
			target: {
				id: targetArticle.id,
				title: targetArticle.title,
				url: targetArticle.sourceUrl,
			},
			highlight: { id: highlights.id, quote: highlights.exact },
		})
		.from(documentLinks)
		.innerJoin(sourceArticle, eq(sourceArticle.id, documentLinks.fromDocumentId))
		.innerJoin(targetArticle, eq(targetArticle.id, documentLinks.toDocumentId))
		.leftJoin(highlights, eq(highlights.id, documentLinks.highlightId))
		.where(
			and(
				eq(documentLinks.userId, userId),
				eq(sourceArticle.userId, userId),
				eq(targetArticle.userId, userId),
				isNull(sourceArticle.deletedAt),
				isNull(targetArticle.deletedAt),
				or(
					isNull(documentLinks.highlightId),
					and(
						eq(highlights.userId, userId),
						eq(highlights.documentId, sourceArticle.id),
						isNull(highlights.deletedAt),
					),
				),
				condition,
			),
		)
}

/** A library article has an incoming or outgoing note link to another live article. */
export function articleHasNoteLinks(userId: string): SQL {
	return exists(
		noteLinksQuery(
			userId,
			or(eq(sourceArticle.id, documents.id), eq(targetArticle.id, documents.id)),
		),
	)
}

/** One row per source note and target. Link rows are rebuilt whenever their note is saved. */
export async function listNoteLinks({
	userId,
	cursor,
	limit = 50,
}: {
	userId: string
	cursor?: string
	limit?: number
}) {
	const rows = await noteLinksQuery(userId, cursor ? lt(documentLinks.id, cursor) : undefined)
		.orderBy(desc(documentLinks.id))
		.limit(limit + 1)
	const items = rows.slice(0, limit)
	return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null }
}

/**
 * Rewrite one note's link rows from its text. Links to articles that are not the user's, and to the
 * article itself, are dropped; links to trashed articles are kept and hidden at read time.
 * `tx` is the transaction that saved the note: its row lock orders two saves of the same note, so
 * the links always match the text that won.
 */
export async function syncNoteLinks(
	{
		userId,
		fromDocumentId,
		highlightId = null,
		text,
	}: {
		userId: string
		fromDocumentId: string
		highlightId?: string | null
		text: string | null
	},
	tx: Tx,
): Promise<void> {
	const ids = text ? extractLinkIds(text).slice(0, LINKS_PER_NOTE) : []
	const wanted = ids.filter((id) => id !== fromDocumentId)
	const source = and(
		eq(documentLinks.fromDocumentId, fromDocumentId),
		highlightId === null
			? isNull(documentLinks.highlightId)
			: eq(documentLinks.highlightId, highlightId),
	)
	// The ids come from text the user typed: only their own documents become rows.
	const targets = wanted.length
		? await tx
				.select({ id: documents.id })
				.from(documents)
				.where(and(eq(documents.userId, userId), inArray(documents.id, wanted)))
		: []
	const known = new Set(targets.map((t) => t.id))
	await tx.delete(documentLinks).where(source)
	const rows = wanted
		.filter((id) => known.has(id))
		.map((toDocumentId) => ({ userId, fromDocumentId, highlightId, toDocumentId }))
	if (rows.length) await tx.insert(documentLinks).values(rows)
}

/** How many live notes link to this article; the same rows `listBacklinks` returns. */
export async function countBacklinks(userId: string, toDocumentId: string): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(documentLinks)
		.innerJoin(
			documents,
			and(eq(documents.id, documentLinks.fromDocumentId), isNull(documents.deletedAt)),
		)
		.leftJoin(highlights, eq(highlights.id, documentLinks.highlightId))
		.where(
			and(
				eq(documentLinks.userId, userId),
				eq(documentLinks.toDocumentId, toDocumentId),
				sql`(${documentLinks.highlightId} is null or ${highlights.deletedAt} is null)`,
			),
		)
	return Number(row?.n ?? 0)
}

/**
 * Articles whose notes link to this one, most recently written link first. Sources in the trash,
 * and links in a deleted highlight's note, are left out.
 */
export async function listBacklinks(
	userId: string,
	toDocumentId: string,
	limit = BACKLINKS_MAX,
): Promise<Backlink[]> {
	const rows = await db
		.select({
			documentId: documentLinks.fromDocumentId,
			title: documents.title,
			sourceUrl: documents.sourceUrl,
			highlightId: documentLinks.highlightId,
			exact: highlights.exact,
			createdAt: documentLinks.createdAt,
		})
		.from(documentLinks)
		.innerJoin(
			documents,
			and(eq(documents.id, documentLinks.fromDocumentId), isNull(documents.deletedAt)),
		)
		.leftJoin(highlights, eq(highlights.id, documentLinks.highlightId))
		.where(
			and(
				eq(documentLinks.userId, userId),
				eq(documentLinks.toDocumentId, toDocumentId),
				// A link inside a deleted highlight's note is gone with it; an article note has no highlight.
				sql`(${documentLinks.highlightId} is null or ${highlights.deletedAt} is null)`,
			),
		)
		// Ids are uuid v7: a tiebreak that agrees with the timestamp when two saves land together.
		.orderBy(desc(documentLinks.createdAt), desc(documentLinks.id))
		.limit(limit)
	return rows.map(({ createdAt: _createdAt, ...b }) => b)
}

/**
 * Connections found in article content, both ways, most recently saved first. Nothing stores them:
 * an outlink is one while a live article of the user has its address, so saving, deleting and
 * restoring an article need no bookkeeping. Note links are not in here; see `listBacklinks`.
 */
export async function listContentLinks(userId: string, documentId: string): Promise<ContentLinks> {
	type Article = typeof sourceArticle | typeof targetArticle
	const list = (self: Article, other: Article) =>
		db
			.select({ documentId: other.id, title: other.title, sourceUrl: other.sourceUrl })
			.from(documentOutlinks)
			.innerJoin(sourceArticle, eq(sourceArticle.id, documentOutlinks.documentId))
			.innerJoin(
				targetArticle,
				and(
					eq(targetArticle.userId, documentOutlinks.userId),
					eq(targetArticle.urlHash, documentOutlinks.urlHash),
				),
			)
			.where(
				and(
					eq(documentOutlinks.userId, userId),
					eq(self.id, documentId),
					ne(other.id, documentId),
					isNull(sourceArticle.deletedAt),
					isNull(targetArticle.deletedAt),
				),
			)
			.orderBy(desc(other.id))
			.limit(CONTENT_LINKS_MAX)
	const [to, from] = await Promise.all([
		list(sourceArticle, targetArticle),
		list(targetArticle, sourceArticle),
	])
	return { to, from }
}

/**
 * Which of these articles are still readable. An id that comes back with nothing is missing:
 * purged, or never the user's in the first place. Every id is looked up, repeats once.
 */
export async function linkTargetStatus(userId: string, ids: string[]): Promise<LinkTargets> {
	const rows = await findTargets(userId, ids)
	return Object.fromEntries(rows.map((d) => [d.id, d.deletedAt ? "trash" : "ok"] as const))
}

/** Like `linkTargetStatus`, with each target's original URL. */
export async function linkTargetDetails(
	userId: string,
	ids: string[],
): Promise<Record<string, { status: "ok" | "trash"; url: string }>> {
	const rows = await findTargets(userId, ids)
	return Object.fromEntries(
		rows.map((d) => [d.id, { status: d.deletedAt ? "trash" : "ok", url: d.url }] as const),
	)
}

async function findTargets(userId: string, ids: string[]) {
	const unique = [...new Set(ids)]
	const rows: Array<{ id: string; deletedAt: Date | null; url: string }> = []
	for (let start = 0; start < unique.length; start += TARGET_LOOKUP_CHUNK) {
		const chunk = unique.slice(start, start + TARGET_LOOKUP_CHUNK)
		rows.push(
			...(await db
				.select({ id: documents.id, deletedAt: documents.deletedAt, url: documents.sourceUrl })
				.from(documents)
				.where(and(eq(documents.userId, userId), inArray(documents.id, chunk)))),
		)
	}
	return rows
}
