/**
 * Editions: pages of articles the user found worth sharing. The edition and its items are a working
 * copy of library data, never a view of it. Only publishing writes the snapshot the public page
 * renders.
 *
 * This module reads: queries, the snapshot and the views built from them, and the row locks the
 * changes take first. The changes are in `commands/editions-actions.server.ts`, which writes through
 * `editions-write.server.ts`.
 */
import {
	and,
	asc,
	type Db,
	db,
	desc,
	documents,
	type Edition,
	type EditionItem,
	type EditionItemHighlight,
	editionItems,
	editions,
	eq,
	gt,
	inArray,
	isNotNull,
	isNull,
	lt,
	ne,
	sql,
	type Tx,
	user as userTable,
} from "@klipstack/db"
import type { TFunction } from "i18next"
import { z } from "zod"
import { AppError } from "~/lib/app-error"
import { type EditionView, editionView } from "~/lib/edition-view"
import {
	EDITION_COVERS,
	editionSlug,
	editionTitle,
	isHttpUrl,
	markdownUrl,
	type NudgeReason,
	nudgeReason,
	type EditionSignals,
} from "~/lib/editions"
import { hasFeature } from "~/lib/features.server"
import { extractLinkIds, rewriteNoteLinks } from "~/lib/note-links"
import { getBrief } from "./ai-threads.server"
import { getDocumentForReader } from "./documents.server"
import { listDocumentHighlights } from "./highlights.server"

const EDITION_REFUSALS = {
	not_found: "No edition, item or article with that id.",
	no_url: "That article has no web address to link to.",
	already_added: "That article is in this edition already.",
	document_gone: "The article this item came from is no longer in the library.",
	not_published: "This edition is not published.",
	edition_removed:
		"An admin removed this edition after a report. It cannot be published again; the email sent to you says why.",
} as const

/** The refusal for `code`, with its message: the reads' and the command's. */
export const refuse = (code: keyof typeof EDITION_REFUSALS) =>
	new AppError(code, EDITION_REFUSALS[code])

/** An edition without its snapshot, which only the public page reads. */
export type EditionRow = Omit<Edition, "userId" | "published">

export const editionColumns = {
	id: editions.id,
	publicId: editions.publicId,
	title: editions.title,
	intro: editions.intro,
	locale: editions.locale,
	cover: editions.cover,
	timeZone: editions.timeZone,
	publishedAt: editions.publishedAt,
	republishedAt: editions.republishedAt,
	unpublishedAt: editions.unpublishedAt,
	removedAt: editions.removedAt,
	removedGround: editions.removedGround,
	removedNote: editions.removedNote,
	createdAt: editions.createdAt,
	updatedAt: editions.updatedAt,
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Ids come from URLs. A malformed one is not found, rather than a Postgres error. */
export function checkId(id: string) {
	if (!UUID.test(id)) throw refuse("not_found")
}

export const owned = (userId: string, id: string) =>
	and(eq(editions.id, id), eq(editions.userId, userId))

export async function findEdition(userId: string, id: string): Promise<EditionRow> {
	checkId(id)
	const [row] = await db.select(editionColumns).from(editions).where(owned(userId, id))
	if (!row) throw refuse("not_found")
	return row
}

/** The user's edition, locked until the transaction ends. */
export async function lockEdition(tx: Tx, userId: string, id: string): Promise<EditionRow> {
	checkId(id)
	const [row] = await tx
		.select(editionColumns)
		.from(editions)
		.where(owned(userId, id))
		.for("update")
	if (!row) throw refuse("not_found")
	return row
}

export async function findItem(
	q: Db | Tx,
	editionId: string,
	itemId: string,
): Promise<EditionItem> {
	checkId(itemId)
	const [item] = await q
		.select()
		.from(editionItems)
		.where(and(eq(editionItems.id, itemId), eq(editionItems.editionId, editionId)))
	if (!item) throw refuse("not_found")
	return item
}

/** The published title, which the public address follows. Null without one, or unpublished. */
const publishedTitle = sql<string | null>`${editions.published}->>'title'`

/** The public page's address, `/e/<publicId>/<slug>`. Null until the first publish. */
function publicPath(
	edition: Pick<EditionRow, "publicId" | "publishedAt" | "timeZone">,
	title: string | null,
): string | null {
	if (!edition.publishedAt) return null
	return `/e/${edition.publicId}/${editionSlug(title, edition.publishedAt, edition.timeZone)}`
}

/** The user's editions, newest first (published by their first publish), with their item counts. */
export async function listEditions(userId: string) {
	const rows = await db
		.select({
			...editionColumns,
			publishedTitle,
			// Plain SQL: Drizzle leaves the table out of column names here, and "id" would be the item's.
			// Set aside, an article is not one of the edition's.
			itemCount: sql<number>`(select count(*)::int from edition_items i where i.edition_id = editions.id and i.included)`,
		})
		.from(editions)
		.where(eq(editions.userId, userId))
		.orderBy(desc(sql`coalesce(${editions.publishedAt}, ${editions.createdAt})`), desc(editions.id))
	return rows.map(({ publishedTitle: title, ...row }) => ({
		...row,
		publicPath: publicPath(row, title),
	}))
}

/**
 * The draft in progress: of the user's editions never published, the one edited last. Marking an
 * article adds it there, and `/editions` shows it first. `lock` holds it until the transaction ends.
 */
export async function currentDraft(
	q: Db | Tx,
	userId: string,
	lock = false,
): Promise<EditionRow | null> {
	const query = q
		.select(editionColumns)
		.from(editions)
		.where(and(eq(editions.userId, userId), isNull(editions.publishedAt)))
		.orderBy(desc(editions.updatedAt), desc(editions.id))
		.limit(1)
	const [row] = lock ? await query.for("update") : await query
	return row ?? null
}

/** The working copy: the edition and its items, in order, and where the public page is. */
export async function getEdition(
	userId: string,
	id: string,
): Promise<{ edition: EditionRow; items: EditionItem[]; publicPath: string | null }> {
	checkId(id)
	const [row] = await db
		.select({ ...editionColumns, publishedTitle })
		.from(editions)
		.where(owned(userId, id))
	if (!row) throw refuse("not_found")
	const { publishedTitle: title, ...edition } = row
	return { edition, items: await listItems(db, id), publicPath: publicPath(edition, title) }
}

/** The id of the edition's item of the article, or null when it has none. */
export async function itemOfArticle(
	q: Db | Tx,
	editionId: string,
	documentId: string,
): Promise<string | null> {
	const [item] = await q
		.select({ id: editionItems.id })
		.from(editionItems)
		.where(and(eq(editionItems.editionId, editionId), eq(editionItems.documentId, documentId)))
	return item?.id ?? null
}

/** The id of the edition's item at `position`, or null when it has none there. */
export async function itemAt(
	q: Db | Tx,
	editionId: string,
	position: number,
): Promise<string | null> {
	const [item] = await q
		.select({ id: editionItems.id })
		.from(editionItems)
		.where(and(eq(editionItems.editionId, editionId), eq(editionItems.position, position)))
	return item?.id ?? null
}

/** Whether an item with this id is in some edition. */
export async function itemExists(q: Db | Tx, itemId: string): Promise<boolean> {
	const [item] = await q
		.select({ id: editionItems.id })
		.from(editionItems)
		.where(eq(editionItems.id, itemId))
	return item !== undefined
}

/**
 * The user's articles marked for an edition and not in it yet, the oldest mark first. Articles in
 * the trash wait there.
 */
export async function shortlistNotIn(userId: string, editionId: string): Promise<string[]> {
	const marked = await db
		.select({ id: documents.id })
		.from(documents)
		.where(
			and(
				eq(documents.userId, userId),
				isNotNull(documents.shortlistedAt),
				isNull(documents.deletedAt),
				sql`not exists (
					select 1 from edition_items i
					where i.edition_id = ${editionId} and i.document_id = ${documents.id}
				)`,
			),
		)
		.orderBy(asc(documents.shortlistedAt), asc(documents.id))
	return marked.map((row) => row.id)
}

/**
 * The user's drafts that have the article, locked until the transaction ends, in id order: the
 * order every change takes their locks in. Their ids.
 */
export async function lockDraftsWith(
	tx: Tx,
	userId: string,
	documentId: string,
): Promise<string[]> {
	const drafts = await tx
		.select({ id: editions.id })
		.from(editions)
		.where(
			and(
				eq(editions.userId, userId),
				isNull(editions.publishedAt),
				sql`exists (
					select 1 from edition_items i
					where i.edition_id = ${editions.id} and i.document_id = ${documentId}
				)`,
			),
		)
		.orderBy(asc(editions.id))
		.for("update")
	return drafts.map((draft) => draft.id)
}

/** The user's live article's notes, locked until the transaction ends. Null without one. */
export async function lockArticleNotes(
	tx: Tx,
	userId: string,
	documentId: string,
): Promise<{ note: string | null; editionNote: string | null } | null> {
	const [doc] = await tx
		.select({ note: documents.note, editionNote: documents.editionNote })
		.from(documents)
		.where(
			and(eq(documents.id, documentId), eq(documents.userId, userId), isNull(documents.deletedAt)),
		)
		.for("update")
	return doc ?? null
}

/** Holds the user's row until the transaction ends: changes that must not run twice at once. */
export async function lockUser(tx: Tx, userId: string) {
	await tx
		.select({ id: userTable.id })
		.from(userTable)
		.where(eq(userTable.id, userId))
		.for("update")
}

/** The edition's items, in order. */
export async function listItems(q: Db | Tx, editionId: string): Promise<EditionItem[]> {
	return q
		.select()
		.from(editionItems)
		.where(eq(editionItems.editionId, editionId))
		.orderBy(asc(editionItems.position))
}

/** The name the user's editions go out under. */
export async function authorName(q: Db | Tx, userId: string): Promise<string> {
	const [author] = await q
		.select({ name: userTable.name })
		.from(userTable)
		.where(eq(userTable.id, userId))
	return author!.name
}

const SUGGESTED_MAX = 200

/** An article the picker offers, with what makes it worth sharing. */
export interface SuggestedDocument {
	id: string
	title: string | null
	siteName: string | null
	url: string
	finished: boolean
	starred: boolean
	/** Highlights it has, not deleted. */
	highlights: number
	note: boolean
	/** In the edition already. */
	added: boolean
}

/** What the picker shows before anything is typed. */
export interface PickerDocuments {
	/** Marked for the next edition, the latest mark first. */
	shortlist: SuggestedDocument[]
	/**
	 * Finished lately (`lately`), not marked and in no other published edition: starred first,
	 * then the latest finished.
	 */
	lately: SuggestedDocument[]
}

const LATELY_DAYS = 30

/**
 * Where "lately" starts for an edition: the first publish of the user's edition before it, else 30
 * days ago. A published edition looks back from the one before it, so its suggestions stay once
 * it is out.
 */
async function lately(userId: string, edition: EditionRow): Promise<Date> {
	const before = edition.publishedAt?.toISOString() ?? "infinity"
	const result = await db.execute<{ since: Date | string }>(sql`
		select coalesce(
			(
				select max(published_at) from editions
				where user_id = ${userId} and id <> ${edition.id} and published_at < ${before}::timestamptz
			),
			now() - make_interval(days => ${LATELY_DAYS})
		) as since
	`)
	return new Date(result.rows[0]!.since)
}

/** The shortlist and what was read lately, for the edition's picker. The search finds the rest. */
export async function pickerDocuments(userId: string, editionId: string): Promise<PickerDocuments> {
	const edition = await findEdition(userId, editionId)
	const from = (await lately(userId, edition)).toISOString()
	const result = await db.execute<{
		id: string
		title: string | null
		siteName: string | null
		url: string
		shortlistedAt: string | null
		starred: boolean
		finished: boolean
		finishedLately: string | null
		highlights: number
		note: boolean
		added: boolean
		published: boolean
	}>(sql`
		select
			d.id,
			d.title,
			d.site_name as "siteName",
			coalesce(d.canonical_url, d.source_url) as url,
			d.shortlisted_at::text as "shortlistedAt",
			d.starred_at is not null as starred,
			d.read_at is not null as finished,
			(
				select max(c.completed_at)::text from reading_completions c
				where c.document_id = d.id and c.completed_at >= ${from}
			) as "finishedLately",
			(
				select count(*)::int from highlights h where h.document_id = d.id and h.deleted_at is null
			) as highlights,
			(d.note is not null or d.edition_note is not null) as note,
			exists (
				select 1 from edition_items i where i.edition_id = ${editionId} and i.document_id = d.id
			) as added,
			-- Set aside in a published edition, an article was not shared.
			exists (
				select 1 from edition_items i join editions e on e.id = i.edition_id
				where i.document_id = d.id and e.id <> ${editionId} and e.published_at is not null
					and i.included
			) as published
		from documents d
		where d.user_id = ${userId} and d.deleted_at is null and (
			d.shortlisted_at is not null
			or d.id in (
				select document_id from reading_completions
				where user_id = ${userId} and completed_at >= ${from}
			)
		)
	`)
	const view = (row: (typeof result.rows)[number]): SuggestedDocument => ({
		id: row.id,
		title: row.title,
		siteName: row.siteName,
		url: row.url,
		finished: row.finished,
		starred: row.starred,
		highlights: row.highlights,
		note: row.note,
		added: row.added,
	})
	const by =
		<T>(key: (row: T) => string | number) =>
		(a: T, b: T) =>
			key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0
	const shortlist = result.rows
		.filter((row) => row.shortlistedAt !== null)
		.sort(by((row) => row.shortlistedAt!))
	const readLately = result.rows
		.filter((row) => row.shortlistedAt === null && row.finishedLately !== null && !row.published)
		.sort(by((row) => row.finishedLately!))
		.sort(by((row) => Number(row.starred)))
	return {
		shortlist: shortlist.slice(0, SUGGESTED_MAX).map(view),
		lately: readLately.slice(0, SUGGESTED_MAX).map(view),
	}
}

/** An article marked for the next edition, as `/editions` lists it. */
export interface ShortlistEntry {
	id: string
	title: string | null
	siteName: string | null
	url: string
	shortlistedAt: Date
	/** What the user wrote for the edition while reading; null for nothing yet. */
	editionNote: string | null
}

/** What the nudge for a new edition goes by, and its verdict (`nudgeReason`). */
export interface EditionNudge extends EditionSignals {
	/** Null when no edition is due, or "Not now" still holds. */
	reason: NudgeReason | null
}

const DAY_MS = 86_400_000

/**
 * Whether an edition is due, and why: what the sidebar's dot and `/editions` show. A new one, or the
 * draft in progress published. Marks in the trash do not count.
 */
export async function editionNudge(userId: string, now = new Date()): Promise<EditionNudge> {
	const [result, draft] = await Promise.all([
		db.execute<{
			marked: number
			last: Date | string | null
			after: string | null
		}>(sql`
			select
				(
					select count(*)::int from documents
					where user_id = ${userId} and shortlisted_at is not null and deleted_at is null
				) as marked,
				(select max(published_at) from editions where user_id = ${userId}) as last,
				u.prefs->>'editionsNudgeAfter' as after
			from "user" u where u.id = ${userId}
		`),
		currentDraft(db, userId),
	])
	const row = result.rows[0]
	const last = row?.last ? new Date(row.last) : null
	let readSince = 0
	if (last) {
		const read = await db.execute<{ n: number }>(sql`
			select count(distinct c.document_id)::int as n
			from reading_completions c join documents d on d.id = c.document_id
			where c.user_id = ${userId} and d.deleted_at is null and c.completed_at >= ${last.toISOString()}
		`)
		readSince = read.rows[0]?.n ?? 0
	}
	const signals: EditionSignals = {
		marked: row?.marked ?? 0,
		daysSince: last ? Math.floor((now.getTime() - last.getTime()) / DAY_MS) : null,
		readSince,
		draft: draft
			? {
					// Not below 0: the database's clock may run a little ahead of this one.
					days: Math.max(0, Math.floor((now.getTime() - draft.createdAt.getTime()) / DAY_MS)),
					items: await countItems(draft.id),
				}
			: null,
	}
	const snoozed = row?.after ? new Date(row.after) > now : false
	return { ...signals, reason: snoozed ? null : nudgeReason(signals) }
}

/** The draft's articles going out: those set aside don't count. */
async function countItems(editionId: string): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(editionItems)
		.where(and(eq(editionItems.editionId, editionId), eq(editionItems.included, true)))
	return row?.n ?? 0
}

/** The user's shortlist, the latest mark first. Articles in the trash wait there, unlisted. */
export async function listShortlist(userId: string): Promise<ShortlistEntry[]> {
	const rows = await db
		.select({
			id: documents.id,
			title: documents.title,
			siteName: documents.siteName,
			url: sql<string>`coalesce(${documents.canonicalUrl}, ${documents.sourceUrl})`,
			shortlistedAt: documents.shortlistedAt,
			editionNote: documents.editionNote,
		})
		.from(documents)
		.where(
			and(
				eq(documents.userId, userId),
				isNotNull(documents.shortlistedAt),
				isNull(documents.deletedAt),
			),
		)
		.orderBy(desc(documents.shortlistedAt), desc(documents.id))
	return rows.map((row) => ({ ...row, shortlistedAt: row.shortlistedAt! }))
}

export type ItemCopy = Omit<
	typeof editionItems.$inferInsert,
	"id" | "editionId" | "documentId" | "position" | "includeNote"
> & { highlights: EditionItemHighlight[]; includeNote: boolean }

/**
 * What an edition keeps of an article: metadata, a note and the highlights, nothing of its
 * content. The note is the one written for editions, included; else the private note, left out
 * until the user includes it. "Add" and "Refresh from library" both copy with this. The article
 * must be live.
 */
export async function copyItem(
	userId: string,
	documentId: string,
	edition: EditionRow,
): Promise<ItemCopy> {
	checkId(documentId)
	const [doc] = await db
		.select({
			title: documents.title,
			canonicalUrl: documents.canonicalUrl,
			sourceUrl: documents.sourceUrl,
			author: documents.author,
			siteName: documents.siteName,
			description: documents.description,
			leadImageUrl: documents.leadImageUrl,
			readingMinutes: documents.readingMinutes,
			wordCount: documents.wordCount,
			note: documents.note,
			editionNote: documents.editionNote,
			// The last time it was finished. Plain SQL for the columns: Drizzle leaves the table out
			// of them here.
			readOn: sql<string | null>`coalesce(
				(
					select to_char(max(c.completed_at) at time zone ${edition.timeZone}, 'YYYY-MM-DD')
					from reading_completions c where c.document_id = documents.id
				),
				to_char(documents.read_at at time zone ${edition.timeZone}, 'YYYY-MM-DD')
			)`,
		})
		.from(documents)
		.where(
			and(eq(documents.id, documentId), eq(documents.userId, userId), isNull(documents.deletedAt)),
		)
	if (!doc) throw refuse("not_found")
	const url = [doc.canonicalUrl, doc.sourceUrl].find(isHttpUrl)
	if (!url) throw refuse("no_url")
	const kept = (await listDocumentHighlights(userId, documentId)).filter((h) => !h.orphaned)
	const note = doc.editionNote ?? doc.note
	const rewrite = await noteLinkRewriter(userId, [note, ...kept.map((h) => h.note)])
	return {
		url,
		title: doc.title?.trim() || url,
		author: doc.author,
		siteName: doc.siteName,
		description: doc.description,
		leadImageUrl: isHttpUrl(doc.leadImageUrl) ? doc.leadImageUrl : null,
		readingMinutes: doc.readingMinutes,
		wordCount: doc.wordCount,
		readOn: doc.readOn,
		note: rewrite(note),
		includeNote: doc.editionNote !== null,
		highlights: kept.map((h) => ({
			highlightId: h.id,
			exact: h.exact,
			note: rewrite(h.note),
			startOffset: h.startOffset,
			included: false,
		})),
	}
}

/**
 * Note links point into the library (`/read/<id>`), which nobody else can open. An edition's copy
 * links to the article's own address instead. A link to an article in the trash, gone, or without
 * an http(s) address becomes its plain title.
 */
export async function noteLinkRewriter(userId: string, texts: Array<string | null>) {
	const ids = [...new Set(texts.flatMap((text) => (text ? extractLinkIds(text) : [])))]
	const urls = new Map<string, string>()
	if (ids.length > 0) {
		const rows = await db
			.select({
				id: documents.id,
				canonicalUrl: documents.canonicalUrl,
				sourceUrl: documents.sourceUrl,
			})
			.from(documents)
			.where(
				and(eq(documents.userId, userId), inArray(documents.id, ids), isNull(documents.deletedAt)),
			)
		for (const row of rows) {
			const url = [row.canonicalUrl, row.sourceUrl].find(isHttpUrl)
			if (url) urls.set(row.id, markdownUrl(url))
		}
	}
	return (text: string | null) =>
		text === null ? null : rewriteNoteLinks(text, (id) => urls.get(id) ?? null)
}

/**
 * What marking or unmarking articles did to the draft in progress, for its undo: the items it added
 * (ids), the ones it took out, as they were, and those too big to carry, which undo copies from the
 * library again, where they were.
 */
export interface DraftChange {
	editionId: string
	added: string[]
	removed: EditionItem[]
	recopy?: Array<{ documentId: string; position: number }>
}

/** Copies of articles, by id, for the draft in progress. */
export type DraftCopies = Map<string, ItemCopy>

/**
 * Copies of the articles as `addItem` makes them, made before the transaction that adds them: the
 * copy reads the library on connections of its own. One without a web address, or gone, has none.
 */
export async function draftCopies(
	userId: string,
	draft: EditionRow,
	documentIds: string[],
): Promise<DraftCopies> {
	const copies: DraftCopies = new Map()
	for (const documentId of documentIds) {
		const copy = await copyItem(userId, documentId, draft).catch((error: unknown) => {
			if (error instanceof AppError && (error.code === "no_url" || error.code === "not_found"))
				return null
			throw error
		})
		if (copy) copies.set(documentId, copy)
	}
	return copies
}

/**
 * The draft an undo of `change` writes to: the user's, still unpublished. Null when it is not, and
 * the undo leaves the draft alone.
 */
export async function draftOfChange(
	q: Db | Tx,
	userId: string,
	change: DraftChange,
	lock = false,
): Promise<EditionRow | null> {
	if (!UUID.test(change.editionId)) return null
	const query = q
		.select(editionColumns)
		.from(editions)
		.where(and(owned(userId, change.editionId), isNull(editions.publishedAt)))
	const [row] = lock ? await query.for("update") : await query
	return row ?? null
}

/** The library's copy of an item's article, as the editor's article pane shows it. */
export interface ItemArticle {
	documentId: string
	title: string
	author: string | null
	siteName: string | null
	url: string
	readingMinutes: number | null
	/** The extracted text, sanitized when it was stored. Null until extraction gives one. */
	html: string | null
	versionId: string | null
	/** The user's highlights, as the reader paints them. */
	highlights: Array<{
		id: string
		startOffset: number
		endOffset: number
		note: string | null
		/** Index into HIGHLIGHT_COLORS: the pane paints it in its own color, as the reader does. */
		color: number
		orphaned: boolean
		versionId: string
	}>
	/** The brief the user asked for while reading, if any. The pane never writes one. */
	brief: string | null
}

/**
 * The article an item came from, to read without leaving the editor. Read only. An item whose
 * article is in the trash or deleted has none to read (`document_gone`).
 */
export async function itemArticle(
	userId: string,
	editionId: string,
	itemId: string,
): Promise<ItemArticle> {
	await findEdition(userId, editionId)
	const { documentId } = await findItem(db, editionId, itemId)
	const found = documentId ? await getDocumentForReader(userId, documentId) : null
	if (!found) throw refuse("document_gone")
	const { document: doc, version } = found
	const url = [doc.canonicalUrl, doc.sourceUrl].find(isHttpUrl) ?? doc.sourceUrl
	const [highlights, brief] = await Promise.all([
		listDocumentHighlights(userId, doc.id),
		version && (await hasFeature(userId, "ai")) ? getBrief(userId, version.id) : null,
	])
	return {
		documentId: doc.id,
		title: doc.title?.trim() || url,
		author: doc.author,
		siteName: doc.siteName,
		url,
		readingMinutes: doc.readingMinutes,
		html: version?.html ?? null,
		versionId: version?.id ?? null,
		highlights: highlights.map((h) => ({
			id: h.id,
			startOffset: h.startOffset,
			endOffset: h.endOffset,
			note: h.note,
			color: h.color,
			orphaned: h.orphaned,
			versionId: h.versionId,
		})),
		brief: brief?.text ?? null,
	}
}

const snapshotSchema = z.object({
	v: z.literal(1),
	/** Null for none: the page shows the date. Snapshots from before 2026-10 also hold a period. */
	title: z.string().nullable(),
	intro: z.string().nullable(),
	authorName: z.string(),
	locale: z.string(),
	/** Pages published before covers had one: the first, the default. */
	cover: z.enum(EDITION_COVERS).default(EDITION_COVERS[0]),
	items: z.array(
		z.object({
			url: z.string(),
			title: z.string(),
			author: z.string().nullable(),
			siteName: z.string().nullable(),
			description: z.string().nullable(),
			leadImageUrl: z.string().nullable(),
			readingMinutes: z.number().nullable(),
			readOn: z.string().nullable(),
			note: z.string().nullable(),
			highlights: z.array(z.object({ exact: z.string(), note: z.string().nullable() })),
		}),
	),
})

/** Everything the public page renders, and nothing else. */
export type EditionSnapshot = z.output<typeof snapshotSchema>

/** The stored snapshot, or null when it is not one this code can render. */
export function parseSnapshot(value: unknown): EditionSnapshot | null {
	const parsed = snapshotSchema.safeParse(value)
	return parsed.success ? parsed.data : null
}

/**
 * The public page's data from a working copy. Only the items, notes and highlights included go in:
 * none set aside.
 */
export function buildSnapshot(
	edition: Pick<EditionRow, "title" | "intro" | "locale" | "cover">,
	items: readonly EditionItem[],
	authorName: string,
): EditionSnapshot {
	return {
		v: 1,
		title: edition.title,
		intro: edition.intro,
		authorName,
		locale: edition.locale,
		cover: edition.cover,
		items: items
			.filter((item) => item.included)
			.map((item) => ({
				url: item.url,
				title: item.title,
				author: item.author,
				siteName: item.siteName,
				description: item.description,
				leadImageUrl: item.leadImageUrl,
				readingMinutes: item.readingMinutes,
				readOn: item.readOn,
				note: item.includeNote ? item.note : null,
				highlights: item.highlights
					.filter((h) => h.included)
					.map(({ exact, note }) => ({ exact, note })),
			})),
	}
}

/**
 * The working copy as its public page would show it once published: the preview page, and the
 * editor's side by side. A draft's date is today. Publishing again shows "Updated" with that day's
 * date.
 */
export async function previewView(
	userId: string,
	edition: EditionRow,
	items: readonly EditionItem[],
	authorName: string,
	t: TFunction<"editions">,
): Promise<EditionView> {
	const now = new Date()
	const publishedAt = edition.publishedAt ?? now
	return editionView(
		buildSnapshot(edition, items, authorName),
		{ publishedAt, republishedAt: edition.publishedAt ? now : null, timeZone: edition.timeZone },
		t,
		await editionNeighbors(userId, { id: edition.id, publishedAt }, edition.locale),
	)
}

const PUBLIC_ID = /^[0-9A-Za-z]{12}$/

/**
 * What the public page reads, from the edition's own row and nothing else. Null when there is no
 * such edition, or it was never published: a draft is as unknown as a wrong id. A removed one
 * comes with `removedAt`, and is gone as an unpublished one is.
 */
export async function getPublicEdition(publicId: string) {
	if (!PUBLIC_ID.test(publicId)) return null
	const [row] = await db
		.select({
			id: editions.id,
			userId: editions.userId,
			published: editions.published,
			publishedAt: editions.publishedAt,
			republishedAt: editions.republishedAt,
			unpublishedAt: editions.unpublishedAt,
			removedAt: editions.removedAt,
			timeZone: editions.timeZone,
		})
		.from(editions)
		.where(and(eq(editions.publicId, publicId), isNotNull(editions.publishedAt)))
	return row ?? null
}

/** Another edition of the same author, as a public page links to it. */
export interface EditionNeighbor {
	/** Its published title, else its date, in the language of the page that links to it. */
	title: string
	path: string
}

/**
 * The author's live editions just before and after this one, by first publish, when the author
 * links them (`prefs.linkEditions`). Unpublished and removed editions are skipped. Read when the
 * page renders: an edition published later must show on the older pages.
 */
export async function editionNeighbors(
	userId: string,
	edition: { id: string; publishedAt: Date },
	locale: string,
): Promise<{ previous: EditionNeighbor | null; next: EditionNeighbor | null }> {
	const none = { previous: null, next: null }
	const [owner] = await db
		.select({ prefs: userTable.prefs })
		.from(userTable)
		.where(eq(userTable.id, userId))
	if (owner?.prefs.linkEditions !== "on") return none
	const neighbor = async (later: boolean) => {
		const [row] = await db
			.select({
				publicId: editions.publicId,
				title: publishedTitle,
				publishedAt: editions.publishedAt,
				timeZone: editions.timeZone,
			})
			.from(editions)
			.where(
				and(
					eq(editions.userId, userId),
					ne(editions.id, edition.id),
					isNotNull(editions.published),
					isNull(editions.unpublishedAt),
					isNull(editions.removedAt),
					later
						? gt(editions.publishedAt, edition.publishedAt)
						: lt(editions.publishedAt, edition.publishedAt),
				),
			)
			.orderBy(later ? asc(editions.publishedAt) : desc(editions.publishedAt))
			.limit(1)
		if (!row?.publishedAt) return null
		const published = { publishedAt: row.publishedAt, locale, timeZone: row.timeZone }
		return {
			title: editionTitle(row.title, published),
			path: publicPath(row, row.title)!,
		}
	}
	const [previous, next] = await Promise.all([neighbor(false), neighbor(true)])
	return { previous, next }
}

/** An edition in the account export: the working copy, and the published snapshot if any. */
export interface ExportedEdition {
	id: string
	publicId: string
	title: string | null
	intro: string | null
	locale: string
	timeZone: string
	createdAt: string
	updatedAt: string
	publishedAt: string | null
	republishedAt: string | null
	unpublishedAt: string | null
	items: Array<{
		/** Null once the article was permanently deleted. */
		documentId: string | null
		url: string
		title: string
		author: string | null
		siteName: string | null
		description: string | null
		leadImageUrl: string | null
		readingMinutes: number | null
		wordCount: number | null
		readOn: string | null
		note: string | null
		includeNote: boolean
		/** False when set aside: in the working copy, not on the public page. */
		included: boolean
		highlights: Array<{
			highlightId: string
			exact: string
			note: string | null
			included: boolean
		}>
	}>
	/** What the public page shows; null until the first publish. */
	published: EditionSnapshot | null
}

/** Every edition of the user, oldest first, for the export. */
export async function exportEditions(userId: string): Promise<ExportedEdition[]> {
	const rows = await db
		.select({ ...editionColumns, published: editions.published })
		.from(editions)
		.where(eq(editions.userId, userId))
		.orderBy(asc(editions.createdAt), asc(editions.id))
	if (rows.length === 0) return []
	const items = await db
		.select()
		.from(editionItems)
		.where(
			inArray(
				editionItems.editionId,
				rows.map((row) => row.id),
			),
		)
		.orderBy(asc(editionItems.position))
	const iso = (date: Date | null) => date?.toISOString() ?? null
	return rows.map((row) => ({
		id: row.id,
		publicId: row.publicId,
		title: row.title,
		intro: row.intro,
		locale: row.locale,
		timeZone: row.timeZone,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		publishedAt: iso(row.publishedAt),
		republishedAt: iso(row.republishedAt),
		unpublishedAt: iso(row.unpublishedAt),
		items: items
			.filter((item) => item.editionId === row.id)
			.map((item) => ({
				documentId: item.documentId,
				url: item.url,
				title: item.title,
				author: item.author,
				siteName: item.siteName,
				description: item.description,
				leadImageUrl: item.leadImageUrl,
				readingMinutes: item.readingMinutes,
				wordCount: item.wordCount,
				readOn: item.readOn,
				note: item.note,
				includeNote: item.includeNote,
				included: item.included,
				highlights: item.highlights.map(({ highlightId, exact, note, included }) => ({
					highlightId,
					exact,
					note,
					included,
				})),
			})),
		published: row.published ? parseSnapshot(row.published) : null,
	}))
}
