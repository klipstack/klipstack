import { gzipSync } from "node:zlib"
import {
	byName,
	and,
	asc,
	type Document,
	db,
	desc,
	documentRaw,
	documents,
	documentVersions,
	documentVia,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	like,
	lte,
	ne,
	not,
	notInArray,
	notifyDocumentEvent,
	or,
	type SQL,
	sql,
	type Tx,
} from "@klipstack/db"
import {
	articleOutlinks,
	ExtractError,
	isHttpUrl,
	normalizeUrl,
	parseXStatusUrl,
	unsupportedReason,
	urlHash,
} from "@klipstack/extract"
import { admitExtract, admitImages } from "@klipstack/queue"
import { AppError } from "~/lib/app-error"
import {
	type ArchiveFilter,
	type FilterableView,
	filtersFor,
	type InboxFilter,
	type ListFilter,
	type ListSort,
	LONG_MIN_MINUTES,
	QUICK_MAX_MINUTES,
	READ_PROGRESS,
} from "~/lib/inbox-filters"
import { type LibraryView, viewFromPath, viewPath } from "~/lib/library-views"
import { checkStorage, countMonthly } from "~/lib/limits.server"
import { cursorFields, isCursorTime, isInt4, isUuid } from "~/lib/page-cursor"
import { articleHasNoteLinks, syncNoteLinks } from "./links.server"
import { inNoTopic, inTopic } from "./topic-scope.server"

export type SaveSource = "web" | "extension" | "api" | "feed"

/** Why a URL cannot be saved, for the API and MCP (the web shows its own text for the code). */
const SAVE_REFUSALS = {
	invalid_url: "That is not a valid http(s) URL.",
	unsupported_twitter: "Klipstack cannot save that kind of X/Twitter page.",
	unsupported_youtube: "Klipstack does not save YouTube videos.",
} as const

const refuse = (code: keyof typeof SAVE_REFUSALS) => new AppError(code, SAVE_REFUSALS[code])

export interface SaveInput {
	userId: string
	url: string
	/** Rendered DOM captured by the extension or an agent; skips server-side fetching. */
	html?: string | null
	source: SaveSource
}

/**
 * Save a URL for a user. Idempotent per (user, normalized URL): re-saving an existing document
 * re-queues extraction only when it failed or when a fresh capture is supplied. A new document
 * counts against the monthly save cap; a new document or capture needs room under the storage
 * cap (`limit_reached`).
 */
export async function saveDocument({
	userId,
	url,
	html,
	source,
}: SaveInput): Promise<{ document: Document; created: boolean }> {
	if (!isHttpUrl(url)) throw refuse("invalid_url")
	let normalized: string
	try {
		normalized = normalizeUrl(url)
	} catch (error) {
		if (error instanceof ExtractError) throw refuse("invalid_url")
		throw error
	}
	const unsupported = unsupportedReason(normalized)
	if (unsupported) throw refuse(`unsupported_${unsupported}`)
	const asSaved = new URL(url)
	asSaved.hash = ""
	const fetchUrl = asSaved.href
	// X pages are an empty JavaScript shell to us; the worker reads posts through an API instead.
	const capture = parseXStatusUrl(normalized) ? null : html
	const hash = urlHash(normalized)

	// A post saved before as the article it shared finds that article.
	const findLive = async () =>
		(await db.query.documents.findFirst({
			where: and(
				eq(documents.userId, userId),
				eq(documents.urlHash, hash),
				isNull(documents.deletedAt),
			),
		})) ??
		(await db.query.documents.findFirst({
			where: and(
				eq(documents.userId, userId),
				isNull(documents.deletedAt),
				inArray(
					documents.id,
					db
						.select({ id: documentVia.documentId })
						.from(documentVia)
						.where(and(eq(documentVia.userId, userId), eq(documentVia.urlHash, hash))),
				),
			),
		}))

	/** Already in the library: queued again only when it failed or a fresh capture came with it. */
	const saveAgain = async (existing: Document) => {
		const needsWork = existing.status === "failed" || Boolean(capture)
		if (capture) await checkStorage(userId)
		if (needsWork) {
			// The capture, the status and the job commit together, through the shared admission.
			const admission = await db.transaction(async (tx) => {
				if (capture) await storeCapture(existing.id, fetchUrl, capture, source, tx)
				const result = await admitExtract(tx, existing.id, capture ? "capture" : "failed")
				if (result.outcome === "admitted")
					await tx
						.update(documents)
						.set({ captureSource: source })
						.where(eq(documents.id, existing.id))
				return result
			})
			if (admission.outcome === "admitted")
				await notifyDocumentEvent({ userId, documentId: existing.id, kind: "queued" })
		}
		return { document: existing, created: false }
	}

	// Two saves of a new URL at once both find nothing; the unique index lets one insert, and the
	// other saves again onto that one. (Twice, in case that one went to the trash meanwhile.)
	for (let attempt = 0; attempt < 2; attempt++) {
		const existing = await findLive()
		if (existing) return saveAgain(existing)

		await checkStorage(userId)
		const created = await db.transaction(async (tx) => {
			const [row] = await tx
				.insert(documents)
				.values({
					userId,
					sourceUrl: normalized,
					fetchUrl,
					urlHash: hash,
					status: "queued",
					captureSource: source,
				})
				.onConflictDoNothing({
					target: [documents.userId, documents.urlHash],
					where: isNull(documents.deletedAt),
				})
				.returning()
			if (!row) return null
			await countMonthly(tx, userId, "saves")
			if (capture) await storeCapture(row.id, fetchUrl, capture, source, tx)
			await admitExtract(tx, row.id, "capture")
			return row
		})
		if (!created) continue
		await notifyDocumentEvent({ userId, documentId: created.id, kind: "queued" })
		return { document: created, created: true }
	}
	throw new Error("save kept conflicting with a document that then disappeared")
}

async function storeCapture(
	documentId: string,
	finalUrl: string,
	html: string,
	source: SaveSource,
	tx: Tx,
) {
	await tx.insert(documentRaw).values({
		documentId,
		rawHtml: gzipSync(Buffer.from(html, "utf8")),
		finalUrl,
		httpStatus: null,
		contentType: "text/html",
		source: source === "extension" ? "extension" : "api",
	})
}

export { type LibraryView, viewFromPath, viewPath }

export const LIBRARY_PAGE_SIZE = 30

export interface LibraryCard {
	id: string
	title: string | null
	siteName: string | null
	author: string | null
	sourceUrl: string
	description: string | null
	readingMinutes: number | null
	status: Document["status"]
	failureReason: string | null
	leadImageUrl: string | null
	leadImageAssetId: string | null
	archivedAt: Date | null
	starredAt: Date | null
	/** Marked for the next edition. */
	shortlistedAt: Date | null
	readAt: Date | null
	readingProgress: number
	createdAt: Date
	publishedAt: Date | null
	deletedAt: Date | null
	firstOpenedAt: Date | null
	/** Tag names, by name. */
	tags: string[]
}

/**
 * A card's tags, as names by name. A subquery in the select, never a join: lists page by keyset or
 * by rank, and a join would give a row per tag.
 *
 * Written by hand, tables and all. Drizzle rewrites the columns it finds in a `sql` field: without
 * their table in a select with no join, and as columns of the root table in a relational query.
 * Three tables here have an `id`.
 */
export const documentTagNames = sql<
	string[]
>`coalesce((select array_agg(t.name order by ${byName(sql`t.name`)}) from document_tags dt inner join tags t on t.id = dt.tag_id where dt.document_id = "documents"."id"), '{}'::text[])`

/** A `LibraryCard`'s columns, for every query that lists cards. */
export const libraryCardColumns = {
	id: documents.id,
	title: documents.title,
	siteName: documents.siteName,
	author: documents.author,
	sourceUrl: documents.sourceUrl,
	description: documents.description,
	readingMinutes: documents.readingMinutes,
	status: documents.status,
	failureReason: documents.failureReason,
	leadImageUrl: documents.leadImageUrl,
	leadImageAssetId: documents.leadImageAssetId,
	archivedAt: documents.archivedAt,
	starredAt: documents.starredAt,
	shortlistedAt: documents.shortlistedAt,
	readAt: documents.readAt,
	readingProgress: documents.readingProgress,
	createdAt: documents.createdAt,
	publishedAt: documents.publishedAt,
	deletedAt: documents.deletedAt,
	firstOpenedAt: documents.firstOpenedAt,
	tags: documentTagNames,
}

/** Where the last card of a page sat in the sort order. `t` is created_at to the microsecond. */
export interface Cursor {
	k: number | null
	t: string
	id: string
}

export function encodeCursor(c: Cursor) {
	return Buffer.from(JSON.stringify(c)).toString("base64url")
}

/** Null for a cursor this server did not write, or that holds values the queries can't read. */
export function decodeCursor(value: string | null | undefined): Cursor | null {
	const c = value ? cursorFields(value) : null
	if (!c || !isCursorTime(c.t) || !isUuid(c.id) || (c.k !== null && !isInt4(c.k))) return null
	return { k: c.k, t: c.t, id: c.id }
}

/** Shared with the search operators (`is:finished`, `is:quick`, `is:long`). */
export const finished = or(
	isNotNull(documents.readAt),
	gte(documents.readingProgress, READ_PROGRESS),
) as SQL
const isX = like(documents.sourceUrl, "https://x.com/%")

export const quick = and(
	lte(documents.readingMinutes, QUICK_MAX_MINUTES),
	eq(documents.type, "article"),
) as SQL
export const long = gte(documents.readingMinutes, LONG_MIN_MINUTES)

/** Quick, long and X reads leave out what is already read: they are about what to read next. */
export const INBOX_FILTER_WHERE: Record<InboxFilter, SQL> = {
	unread: and(isNull(documents.firstOpenedAt), ne(documents.status, "failed")) as SQL,
	progress: and(isNotNull(documents.firstOpenedAt), not(finished)) as SQL,
	read: finished,
	quick: and(quick, not(finished)) as SQL,
	long: and(long, not(finished)) as SQL,
	x: and(isX, not(finished)) as SQL,
}

/** In the archive and starred everything counts, read or not. */
export const ARCHIVE_FILTER_WHERE: Record<ArchiveFilter, SQL> = {
	finished,
	unfinished: not(finished),
	quick,
	long,
	x: isX,
}

export function filterWhere(view: LibraryView, filter: ListFilter): SQL | undefined {
	if (view === "inbox") return INBOX_FILTER_WHERE[filter as InboxFilter]
	if (view === "archive" || view === "starred") return ARCHIVE_FILTER_WHERE[filter as ArchiveFilter]
	return undefined
}

const inInbox = isNull(documents.archivedAt)
const inArchive = isNotNull(documents.archivedAt)

/** What a list view holds, out of the trash. */
export function viewWhere(view: FilterableView): SQL {
	return view === "archive"
		? inArchive
		: view === "starred"
			? isNotNull(documents.starredAt)
			: inInbox
}

/** A topic of the reader's (its id), or no topic: what the lists narrow to (`?topic=`). */
export type TopicScope = string | "none"

export function topicWhere(topic: TopicScope): SQL {
	return topic === "none" ? inNoTopic : inTopic(topic)
}

/** Articles without a length (still extracting, failed) go last in both length orders. */
export const SORT_KEY: Record<ListSort, { key: SQL | null; dir: "asc" | "desc" }> = {
	recent: { key: null, dir: "desc" },
	newest: { key: null, dir: "desc" },
	oldest: { key: null, dir: "asc" },
	shortest: { key: sql`coalesce(${documents.readingMinutes}, 2147483647)`, dir: "asc" },
	longest: { key: sql`coalesce(${documents.readingMinutes}, -1)`, dir: "desc" },
}

export async function listDocuments({
	userId,
	view,
	filter = null,
	sort = view === "inbox" && filter === "progress" ? "recent" : "newest",
	cursor,
	limit = LIBRARY_PAGE_SIZE,
	hasNoteLinks,
	readyOnly = false,
	excludeIds = [],
	topic = null,
}: {
	userId: string
	view: LibraryView
	filter?: ListFilter | null
	/** Only the articles in a topic of the reader's (its id), or in none (`"none"`). */
	topic?: TopicScope | null
	sort?: ListSort
	cursor?: Cursor | null
	limit?: number
	hasNoteLinks?: boolean
	/** Reading suggestions omit extraction placeholders and articles already shown elsewhere. */
	readyOnly?: boolean
	excludeIds?: string[]
}): Promise<{ items: LibraryCard[]; nextCursor: string | null }> {
	const viewFilter =
		view === "trash"
			? isNotNull(documents.deletedAt)
			: view === "starred"
				? isNotNull(documents.starredAt)
				: view === "archive"
					? inArchive
					: inInbox
	const deletedFilter = view === "trash" ? undefined : isNull(documents.deletedAt)
	const { key, dir } = SORT_KEY[sort]
	// Recent reading falls back for older/imported articles without a last-read timestamp.
	const time =
		sort === "recent"
			? sql`coalesce(${documents.lastReadAt}, ${documents.firstOpenedAt}, ${documents.createdAt})`
			: view === "archive"
				? documents.archivedAt
				: view === "starred"
					? documents.starredAt
					: documents.createdAt
	// Ties on the key break by that time, then id, in the same direction: one row comparison.
	const columns = key ? [key, time, documents.id] : [time, documents.id]
	const cursorFilter = cursor
		? sql`(${sql.join(columns, sql`, `)}) ${sql.raw(dir === "desc" ? "<" : ">")} (${sql.join(
				[
					...(key ? [sql`${cursor.k}`] : []),
					sql`${cursor.t}::timestamptz`,
					sql`${cursor.id}::uuid`,
				],
				sql`, `,
			)})`
		: undefined
	const rows = await db
		.select({
			...libraryCardColumns,
			sortKey: key ? sql<number>`${key}` : sql<null>`null`,
			timeExact: sql<string>`to_char(${time} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
		})
		.from(documents)
		.where(
			and(
				eq(documents.userId, userId),
				deletedFilter,
				viewFilter,
				readyOnly ? eq(documents.status, "ready") : undefined,
				excludeIds.length ? notInArray(documents.id, excludeIds) : undefined,
				filter ? filterWhere(view, filter) : undefined,
				topic ? topicWhere(topic) : undefined,
				hasNoteLinks === undefined
					? undefined
					: hasNoteLinks
						? articleHasNoteLinks(userId)
						: not(articleHasNoteLinks(userId)),
				cursorFilter,
			),
		)
		.orderBy(...columns.map((c) => (dir === "desc" ? desc(c) : asc(c))))
		.limit(limit + 1)
	const page = rows.slice(0, limit)
	const last = page[page.length - 1]
	const nextCursor =
		rows.length > limit && last
			? encodeCursor({ k: last.sortKey, t: last.timeExact, id: last.id })
			: null
	const items = page.map(({ sortKey: _k, timeExact: _t, ...card }) => card)
	return { items, nextCursor }
}

/** Articles per filter in a list view, for the filter chips; in a topic, of the topic's. */
export async function countFilters(
	userId: string,
	view: FilterableView,
	topic: TopicScope | null = null,
): Promise<Partial<Record<ListFilter, number>>> {
	const filters = filtersFor(view)
	const [row] = await db
		.select(
			Object.fromEntries(
				filters.map((f) => [f, sql<number>`count(*) filter (where ${filterWhere(view, f)})`]),
			) as Record<string, SQL<number>>,
		)
		.from(documents)
		.where(
			and(
				eq(documents.userId, userId),
				isNull(documents.deletedAt),
				viewWhere(view),
				topic ? topicWhere(topic) : undefined,
			),
		)
	return Object.fromEntries(filters.map((f) => [f, Number(row?.[f] ?? 0)]))
}

/**
 * Of the given URL hashes, the ones already in the library (not in the trash): hash → document id.
 * A post saved as the article it shared counts as that article.
 */
export async function findSavedByHashes(
	userId: string,
	hashes: string[],
): Promise<Map<string, string>> {
	if (hashes.length === 0) return new Map()
	const [rows, shared] = await Promise.all([
		db
			.select({ id: documents.id, urlHash: documents.urlHash })
			.from(documents)
			.where(
				and(
					eq(documents.userId, userId),
					isNull(documents.deletedAt),
					inArray(documents.urlHash, hashes),
				),
			),
		db
			.select({ id: documents.id, urlHash: documentVia.urlHash })
			.from(documentVia)
			.innerJoin(documents, eq(documents.id, documentVia.documentId))
			.where(
				and(
					eq(documentVia.userId, userId),
					isNull(documents.deletedAt),
					inArray(documentVia.urlHash, hashes),
				),
			),
	])
	return new Map([...shared, ...rows].map((row) => [row.urlHash, row.id]))
}

/**
 * The links in an article's HTML that point at other articles in the library: href as written →
 * document id (`articleOutlinks` reads them, as the extract job stores them).
 */
export async function savedLinksIn(
	userId: string,
	documentId: string,
	html: string,
	sourceUrl: string,
): Promise<Record<string, string>> {
	const links = articleOutlinks(html, sourceUrl)
	const saved = await findSavedByHashes(userId, [...new Set(links.map((link) => link.hash))])
	const ids: Record<string, string> = {}
	for (const { href, hash } of links) {
		const id = saved.get(hash)
		if (id && id !== documentId) ids[href] = id
	}
	return ids
}

/**
 * Of the given hrefs, the ones already in the library (not in the trash): href → document id.
 * Hrefs are normalized as saving does, so several spellings of one URL all match.
 */
export async function findSavedByUrls(
	userId: string,
	hrefs: string[],
): Promise<Map<string, string>> {
	const byHash = new Map<string, string[]>()
	for (const href of hrefs) {
		if (!isHttpUrl(href)) continue
		try {
			const hash = urlHash(normalizeUrl(href))
			byHash.set(hash, [...(byHash.get(hash) ?? []), href])
		} catch {
			// unparsable
		}
	}
	const saved = new Map<string, string>()
	for (const [hash, id] of await findSavedByHashes(userId, [...byHash.keys()]))
		for (const href of byHash.get(hash) ?? []) saved.set(href, id)
	return saved
}

export async function countPending(userId: string): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)` })
		.from(documents)
		.where(
			and(
				eq(documents.userId, userId),
				isNull(documents.deletedAt),
				or(eq(documents.status, "queued"), eq(documents.status, "processing")),
			),
		)
	return Number(row?.n ?? 0)
}

/** The user's article `id`, unless it is in the trash: what reads and changes act on. */
function live(userId: string, id: string) {
	return and(eq(documents.id, id), eq(documents.userId, userId), isNull(documents.deletedAt))
}

/**
 * The article with its tags (names), unless it is in the trash. Without its search vector: tens of
 * kilobytes that nothing reads, and the reader would send them to the browser.
 */
export async function getDocument(userId: string, id: string) {
	return db.query.documents.findFirst({
		columns: { search: false, noteSearch: false },
		where: live(userId, id),
		extras: { tags: documentTagNames.as("tags") },
	})
}

export async function getDocumentForReader(userId: string, id: string) {
	const doc = await getDocument(userId, id)
	if (!doc) return null
	const [version, via] = await Promise.all([
		doc.currentVersionId
			? db.query.documentVersions.findFirst({
					where: eq(documentVersions.id, doc.currentVersionId),
					columns: { id: true, version: true, html: true, imagesDone: true },
				})
			: null,
		listSharedVia(doc.id),
	])
	return { document: doc, version: version ?? null, via }
}

/**
 * The posts an article was saved through, oldest first. `restorable`: the article can turn back
 * into the post (the one it was saved as, not one that joined later).
 */
export async function listSharedVia(documentId: string) {
	const rows = await db
		.select({
			id: documentVia.id,
			url: documentVia.url,
			author: documentVia.author,
			siteName: documentVia.siteName,
			html: documentVia.html,
			publishedAt: documentVia.publishedAt,
			rawId: documentVia.rawId,
		})
		.from(documentVia)
		.where(eq(documentVia.documentId, documentId))
		.orderBy(asc(documentVia.createdAt))
	return rows.map(({ rawId, ...via }) => ({ ...via, restorable: rawId !== null }))
}

export type SharedVia = Awaited<ReturnType<typeof listSharedVia>>[number]

/**
 * The article a removed save of a post joined (`document_via.saved_as`): where links to that
 * save lead. Null when there is none, or it is in the trash.
 */
export async function joinedArticleId(userId: string, savedAs: string): Promise<string | null> {
	const [row] = await db
		.select({ id: documents.id })
		.from(documentVia)
		.innerJoin(documents, eq(documents.id, documentVia.documentId))
		.where(
			and(
				eq(documentVia.savedAs, savedAs),
				eq(documentVia.userId, userId),
				isNull(documents.deletedAt),
			),
		)
		.limit(1)
	return row?.id ?? null
}

export interface NoteState {
	note: string | null
	/** Null until the note is first saved. */
	noteUpdatedAt: Date | null
}

export interface NoteCheck {
	/**
	 * Omitted: no check. Null: the note must never have been saved. A time (ISO 8601): it must be
	 * the stored `noteUpdatedAt`, to the millisecond (each save moves it by at least one).
	 */
	expectedUpdatedAt?: string | null
}

export type NoteSave = ({ ok: true } & NoteState) | { ok: false; current: NoteState }

/**
 * The note on the whole article. Blank clears it. Null when the document is not the user's (or is
 * in the trash). With `expectedUpdatedAt`, the check and the write are one conditional update, so
 * two writers cannot both pass; on a mismatch nothing changes and the current note comes back.
 */
export async function setNote(
	userId: string,
	id: string,
	note: string | null,
): Promise<NoteState | null>
export async function setNote(
	userId: string,
	id: string,
	note: string | null,
	check: NoteCheck,
): Promise<NoteSave | null>
export async function setNote(
	userId: string,
	id: string,
	note: string | null,
	check?: NoteCheck,
): Promise<NoteState | NoteSave | null> {
	const expected = check?.expectedUpdatedAt
	const unchanged =
		expected === undefined
			? undefined
			: expected === null
				? isNull(documents.noteUpdatedAt)
				: sql`date_trunc('milliseconds', ${documents.noteUpdatedAt}) = date_trunc('milliseconds', ${expected}::timestamptz)`
	const row = await db.transaction(async (tx) => {
		const [saved] = await tx
			.update(documents)
			.set({
				note: note?.trim() || null,
				// Every save moves the time by at least a millisecond, the precision clients compare at:
				// two saves in the same millisecond would otherwise let a stale expectedUpdatedAt pass.
				noteUpdatedAt: sql`greatest(date_trunc('milliseconds', clock_timestamp()), ${documents.noteUpdatedAt} + interval '1 millisecond')`,
			})
			.where(
				and(
					eq(documents.id, id),
					eq(documents.userId, userId),
					isNull(documents.deletedAt),
					unchanged,
				),
			)
			.returning({ note: documents.note, noteUpdatedAt: documents.noteUpdatedAt })
		if (saved)
			await syncNoteLinks({ userId, fromDocumentId: id, highlightId: null, text: saved.note }, tx)
		return saved
	})
	if (row) return check ? { ok: true, ...row } : row
	if (!unchanged) return null
	const current = await getDocument(userId, id)
	if (!current) return null
	return { ok: false, current: { note: current.note, noteUpdatedAt: current.noteUpdatedAt } }
}

/**
 * Undo of a (soft) delete. False when it is not the user's or not in the trash. Throws a unique
 * violation (`isUniqueViolation`) when the same URL was saved again meanwhile. Work the trash
 * stopped (extraction, then images: their jobs skip trashed articles) is queued again.
 */
export async function restoreDocument(userId: string, id: string): Promise<boolean> {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.update(documents)
			.set({ deletedAt: null })
			.where(
				and(eq(documents.id, id), eq(documents.userId, userId), isNotNull(documents.deletedAt)),
			)
			.returning({ status: documents.status, currentVersionId: documents.currentVersionId })
		if (!row) return false
		if (row.status === "queued" || row.status === "processing")
			await admitExtract(tx, id, "refresh")
		else if (row.currentVersionId) await admitImages(tx, row.currentVersionId)
		return true
	})
}

/** The article in the library (not the trash) saved from the same URL as this trashed one. */
export async function liveDuplicateOf(userId: string, trashedId: string): Promise<string | null> {
	const result = await db.execute<{ id: string }>(sql`
		select live.id from documents trashed
		join documents live on live.user_id = trashed.user_id and live.url_hash = trashed.url_hash
		where trashed.id = ${trashedId} and trashed.user_id = ${userId} and live.deleted_at is null
		limit 1
	`)
	return result.rows[0]?.id ?? null
}
