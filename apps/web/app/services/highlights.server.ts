import { resolveSelector, selectorFor, type TextSelector } from "@klipstack/anchor"
import { QUOTE_MAX } from "@klipstack/api-contract"
import {
	and,
	asc,
	db,
	desc,
	documents,
	documentVersions,
	eq,
	getTableColumns,
	inArray,
	type Highlight,
	highlights,
	isNotNull,
	isNull,
	ne,
	type SQL,
	sql,
	termQuery,
} from "@klipstack/db"
import { HIGHLIGHT_COLOR_NAMES } from "~/lib/highlight-colors"
import { HIGHLIGHT_FILTERS, type HighlightFilter, searchTerms } from "~/lib/highlight-filters"
import { type ModificationRange, modificationRange } from "./annotation-dates.server"
import { getDocument } from "./documents.server"
import { syncNoteLinks } from "./links.server"

export const HIGHLIGHT_COLORS = 5

/** A highlight's columns but its search vector, which nothing outside a search reads. */
const { search: _search, ...highlightColumns } = getTableColumns(highlights)

export interface ResizeInput {
	userId: string
	documentId: string
	id: string
	versionId: string
	previous: Pick<TextSelector, "start" | "end" | "exact">
	selector: TextSelector
}

export type ResizeResult =
	| { ok: true; highlight: Highlight }
	| {
			ok: false
			error: "not_found" | "version_changed" | "highlight_changed" | "invalid_range" | "no_match"
	  }

/** Precise anchor edit. Lock the document before its highlight, including for safe retries. */
export async function resizeHighlight(input: ResizeInput): Promise<ResizeResult> {
	return db.transaction(async (tx) => {
		const [doc] = await tx
			.select()
			.from(documents)
			.where(
				and(
					eq(documents.id, input.documentId),
					eq(documents.userId, input.userId),
					isNull(documents.deletedAt),
				),
			)
			.for("update")
		if (!doc) return { ok: false, error: "not_found" }
		const [h] = await tx
			.select(highlightColumns)
			.from(highlights)
			.where(
				and(
					eq(highlights.id, input.id),
					eq(highlights.documentId, doc.id),
					eq(highlights.userId, input.userId),
					isNull(highlights.deletedAt),
				),
			)
			.for("update")
		if (!h || h.orphaned) return { ok: false, error: "not_found" }
		if (
			doc.currentVersionId !== input.versionId ||
			doc.status !== "ready" ||
			h.versionId !== input.versionId
		)
			return { ok: false, error: "version_changed" }
		const version = await tx.query.documentVersions.findFirst({
			where: and(eq(documentVersions.id, input.versionId), eq(documentVersions.documentId, doc.id)),
		})
		if (!version) return { ok: false, error: "version_changed" }
		const { start, end, exact } = input.selector
		if (
			!Number.isInteger(start) ||
			!Number.isInteger(end) ||
			start < 0 ||
			end > version.text.length ||
			start >= end ||
			end - start > QUOTE_MAX ||
			!exact.trim()
		)
			return { ok: false, error: "invalid_range" }
		if (version.text.slice(start, end) !== exact) return { ok: false, error: "no_match" }
		if (h.startOffset === start && h.endOffset === end && h.exact === exact)
			return { ok: true, highlight: h }
		const before = input.previous
		if (h.startOffset !== before.start || h.endOffset !== before.end || h.exact !== before.exact)
			return { ok: false, error: "highlight_changed" }
		const selector = selectorFor(version.text, start, end)
		const [saved] = await tx
			.update(highlights)
			.set({
				startOffset: start,
				endOffset: end,
				exact: selector.exact,
				prefix: selector.prefix,
				suffix: selector.suffix,
				versionId: version.id,
				orphaned: false,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(highlights.id, h.id),
					eq(highlights.versionId, input.versionId),
					eq(highlights.startOffset, before.start),
					eq(highlights.endOffset, before.end),
					eq(highlights.exact, before.exact),
					isNull(highlights.deletedAt),
				),
			)
			.returning(highlightColumns)
		return saved ? { ok: true, highlight: saved } : { ok: false, error: "highlight_changed" }
	})
}

export interface HighlightInput {
	exact: string
	prefix?: string
	suffix?: string
	start?: number
	end?: number
	color?: number
	note?: string | null
}

export type CreateResult =
	| { ok: true; highlight: Highlight }
	| { ok: false; error: "not_found" | "not_ready" | "no_match" }
	| { ok: false; error: "ambiguous"; candidates: Array<{ start: number; end: number }> }

/** A document version's canonical text (what highlight offsets index into). */
export async function currentText(documentId: string, versionId: string | null) {
	if (!versionId) return null
	const v = await db.query.documentVersions.findFirst({
		where: and(eq(documentVersions.id, versionId), eq(documentVersions.documentId, documentId)),
		columns: { id: true, text: true },
	})
	return v ?? null
}

/**
 * Create a highlight from a quote (and optional offsets). The server resolves the final offsets
 * against the current version's canonical text, so every client (browser, extension, agent)
 * gets identical anchors.
 */
export async function createHighlight({
	userId,
	documentId,
	input,
}: {
	userId: string
	documentId: string
	input: HighlightInput
}): Promise<CreateResult> {
	const doc = await getDocument(userId, documentId)
	if (!doc) return { ok: false, error: "not_found" }
	const version = await currentText(documentId, doc.currentVersionId)
	if (!version || doc.status !== "ready") return { ok: false, error: "not_ready" }

	const resolved = resolveSelector(version.text, input)
	if (!resolved) return { ok: false, error: "no_match" }
	if ("ambiguous" in resolved)
		return { ok: false, error: "ambiguous", candidates: resolved.candidates }

	const selector = selectorFor(version.text, resolved.start, resolved.end)
	const color = clampColor(input.color)
	const row = await db.transaction(async (tx) => {
		const [created] = await tx
			.insert(highlights)
			.values({
				documentId,
				userId,
				versionId: version.id,
				startOffset: selector.start,
				endOffset: selector.end,
				exact: selector.exact,
				prefix: selector.prefix,
				suffix: selector.suffix,
				color,
				note: input.note?.trim() || null,
			})
			.returning(highlightColumns)
		if (!created) throw new Error("highlight insert returned nothing")
		if (created.note)
			await syncNoteLinks(
				{ userId, fromDocumentId: documentId, highlightId: created.id, text: created.note },
				tx,
			)
		return created
	})
	return { ok: true, highlight: row }
}

export function clampColor(color: number | undefined): number {
	if (typeof color !== "number" || Number.isNaN(color)) return 0
	return Math.min(HIGHLIGHT_COLORS - 1, Math.max(0, Math.floor(color)))
}

/**
 * Highlights for a document, re-anchored to the current version when the document was
 * re-extracted since they were made. Unresolvable ones are flagged orphaned but still returned.
 */
export async function listDocumentHighlights(
	userId: string,
	documentId: string,
): Promise<Highlight[]> {
	const doc = await getDocument(userId, documentId)
	if (!doc) return []
	const rows = await db.query.highlights.findMany({
		columns: { search: false },
		where: and(
			eq(highlights.documentId, documentId),
			eq(highlights.userId, userId),
			isNull(highlights.deletedAt),
		),
		orderBy: [asc(highlights.startOffset), asc(highlights.createdAt)],
	})
	const stale = rows.filter((h) => h.versionId !== doc.currentVersionId)
	if (stale.length === 0 || !doc.currentVersionId) return rows

	const version = await currentText(documentId, doc.currentVersionId)
	if (!version) return rows
	const updated = new Map<string, Highlight>()
	for (const h of stale) {
		const resolved = resolveSelector(version.text, {
			exact: h.exact,
			prefix: h.prefix,
			suffix: h.suffix,
			start: h.startOffset,
			end: h.endOffset,
		})
		if (resolved && !("ambiguous" in resolved)) {
			const sel = selectorFor(version.text, resolved.start, resolved.end)
			const [row] = await db
				.update(highlights)
				.set({
					versionId: version.id,
					startOffset: sel.start,
					endOffset: sel.end,
					// A loose match (spacing, quote marks, case) found it: the quote is now what the text says.
					exact: sel.exact,
					prefix: sel.prefix,
					suffix: sel.suffix,
					orphaned: false,
				})
				.where(
					and(
						eq(highlights.id, h.id),
						eq(highlights.versionId, h.versionId),
						eq(highlights.startOffset, h.startOffset),
						eq(highlights.endOffset, h.endOffset),
						eq(highlights.exact, h.exact),
						isNull(highlights.deletedAt),
					),
				)
				.returning(highlightColumns)
			if (row) updated.set(h.id, row)
		} else if (!h.orphaned) {
			const [row] = await db
				.update(highlights)
				.set({ orphaned: true })
				.where(
					and(
						eq(highlights.id, h.id),
						eq(highlights.versionId, h.versionId),
						eq(highlights.startOffset, h.startOffset),
						eq(highlights.endOffset, h.endOffset),
						eq(highlights.exact, h.exact),
						isNull(highlights.deletedAt),
					),
				)
				.returning(highlightColumns)
			if (row) updated.set(h.id, row)
		}
	}
	return rows.map((h) => updated.get(h.id) ?? h).sort((a, b) => a.startOffset - b.startOffset)
}

export async function updateHighlight(
	userId: string,
	id: string,
	patch: { note?: string | null; color?: number },
): Promise<Highlight | null> {
	const set: Partial<typeof highlights.$inferInsert> = {}
	if ("note" in patch) set.note = patch.note?.trim() || null
	if (typeof patch.color === "number") set.color = clampColor(patch.color)
	if (Object.keys(set).length === 0)
		return db.query.highlights
			.findFirst({
				columns: { search: false },
				where: and(eq(highlights.id, id), eq(highlights.userId, userId)),
			})
			.then((r) => r ?? null)
	return db.transaction(async (tx) => {
		const [row] = await tx
			.update(highlights)
			.set(set)
			.where(
				and(eq(highlights.id, id), eq(highlights.userId, userId), isNull(highlights.deletedAt)),
			)
			.returning(highlightColumns)
		if (row && "note" in patch)
			await syncNoteLinks(
				{ userId, fromDocumentId: row.documentId, highlightId: row.id, text: row.note },
				tx,
			)
		return row ?? null
	})
}

/** Undo of a delete, while the article is in the library. False when there was none to undo. */
export async function restoreHighlight(userId: string, id: string): Promise<boolean> {
	const live = db
		.select({ id: documents.id })
		.from(documents)
		.where(and(eq(documents.userId, userId), isNull(documents.deletedAt)))
	const rows = await db
		.update(highlights)
		.set({ deletedAt: null })
		.where(
			and(
				eq(highlights.id, id),
				eq(highlights.userId, userId),
				isNotNull(highlights.deletedAt),
				inArray(highlights.documentId, live),
			),
		)
		.returning({ id: highlights.id })
	return rows.length > 0
}

/** One of the user's highlights, unless it was deleted. */
export async function getHighlight(userId: string, id: string): Promise<Highlight | null> {
	const row = await db.query.highlights.findFirst({
		columns: { search: false },
		where: and(eq(highlights.id, id), eq(highlights.userId, userId), isNull(highlights.deletedAt)),
	})
	return row ?? null
}

/** Deleted, until undone (`restoreHighlight`); a highlight deleted already keeps its time. */
export async function deleteHighlight(userId: string, id: string): Promise<void> {
	await db
		.update(highlights)
		.set({ deletedAt: new Date() })
		.where(and(eq(highlights.id, id), eq(highlights.userId, userId), isNull(highlights.deletedAt)))
}

export interface HighlightListItem {
	id: string
	documentId: string
	exact: string
	prefix: string
	suffix: string
	note: string | null
	color: number
	orphaned: boolean
	startOffset: number
	endOffset: number
	createdAt: Date
	updatedAt: Date
	documentTitle: string | null
	author: string | null
	siteName: string | null
	sourceUrl: string
}

export interface HighlightArticle {
	documentId: string
	documentTitle: string | null
	author: string | null
	siteName: string | null
	sourceUrl: string
	/** Highlights in reading order. */
	highlights: HighlightListItem[]
	latestAt: Date
}

export const HIGHLIGHTS_PAGE_SIZE = 50
/** The "by article" view loads everything that matches; users have hundreds, not thousands. */
const ARTICLES_VIEW_MAX = 2000

const listColumns = {
	id: highlights.id,
	documentId: highlights.documentId,
	exact: highlights.exact,
	prefix: highlights.prefix,
	suffix: highlights.suffix,
	note: highlights.note,
	color: highlights.color,
	orphaned: highlights.orphaned,
	startOffset: highlights.startOffset,
	endOffset: highlights.endOffset,
	createdAt: highlights.createdAt,
	updatedAt: highlights.updatedAt,
	documentTitle: documents.title,
	author: documents.author,
	siteName: documents.siteName,
	sourceUrl: documents.sourceUrl,
}

/**
 * Every term (a word, or a "quoted phrase") must appear somewhere: the quote, the note, or the
 * article's title, author or site. Case and accents never matter; a word also matches its variants
 * and longer words it starts. Through the highlights' search vector and its index.
 */
function searchWhere(q: string | undefined): SQL | undefined {
	const terms = searchTerms(q ?? "")
	if (terms.length === 0) return undefined
	return sql`${highlights.search} @@ (${sql.join(terms.map(termQuery), sql` && `)})`
}

const hasNote = and(isNotNull(highlights.note), ne(highlights.note, "")) as SQL

function filterWhere(filter: HighlightFilter): SQL {
	return filter === "notes" ? hasNote : eq(highlights.color, HIGHLIGHT_COLOR_NAMES.indexOf(filter))
}

function baseWhere(userId: string, q?: string) {
	return and(
		eq(highlights.userId, userId),
		eq(documents.userId, userId),
		isNull(highlights.deletedAt),
		isNull(documents.deletedAt),
		searchWhere(q),
	)
}

/** created_at to the microsecond: a JavaScript Date would drop the last three digits. */
const createdAtExact = sql<string>`to_char(${highlights.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

/**
 * Newest first, one page at a time. The cursor holds the last row's created_at to the microsecond
 * (older cursors in milliseconds still work), compared in SQL together with the id.
 */
export async function listUserHighlights({
	userId,
	cursor,
	q,
	filter = null,
	documentId,
	createdSince,
	createdBefore,
	updatedSince,
	updatedBefore,
	limit = HIGHLIGHTS_PAGE_SIZE,
}: ModificationRange & {
	userId: string
	cursor?: { createdAt: string; id: string } | null
	q?: string
	filter?: HighlightFilter | null
	/** Only this article's highlights. */
	documentId?: string
	createdSince?: string
	createdBefore?: string
	limit?: number
}): Promise<{ items: HighlightListItem[]; nextCursor: { createdAt: string; id: string } | null }> {
	const cursorFilter = cursor
		? sql`(${highlights.createdAt}, ${highlights.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
		: undefined
	const rows = await db
		.select({ ...listColumns, createdAtExact })
		.from(highlights)
		.innerJoin(documents, eq(documents.id, highlights.documentId))
		.where(
			and(
				baseWhere(userId, q),
				filter ? filterWhere(filter) : undefined,
				documentId ? eq(highlights.documentId, documentId) : undefined,
				createdSince ? sql`${highlights.createdAt} >= ${createdSince}::timestamptz` : undefined,
				createdBefore ? sql`${highlights.createdAt} < ${createdBefore}::timestamptz` : undefined,
				modificationRange(highlights.updatedAt, { updatedSince, updatedBefore }),
				cursorFilter,
			),
		)
		.orderBy(desc(highlights.createdAt), desc(highlights.id))
		.limit(limit + 1)
	const page = rows.slice(0, limit)
	const last = page[page.length - 1]
	return {
		items: page.map(({ createdAtExact: _exact, ...item }) => item),
		nextCursor:
			rows.length > limit && last ? { createdAt: last.createdAtExact, id: last.id } : null,
	}
}

/** One of the user's highlights with its article, unless either is deleted or in the trash. */
export async function getHighlightWithArticle(
	userId: string,
	id: string,
): Promise<HighlightListItem | null> {
	const [row] = await db
		.select(listColumns)
		.from(highlights)
		.innerJoin(documents, eq(documents.id, highlights.documentId))
		.where(and(eq(highlights.id, id), baseWhere(userId)))
		.limit(1)
	return row ?? null
}

/** Articles with matching highlights, most recently highlighted first. */
export async function listHighlightArticles({
	userId,
	q,
	filter = null,
}: {
	userId: string
	q?: string
	filter?: HighlightFilter | null
}): Promise<HighlightArticle[]> {
	const rows = await db
		.select(listColumns)
		.from(highlights)
		.innerJoin(documents, eq(documents.id, highlights.documentId))
		.where(and(baseWhere(userId, q), filter ? filterWhere(filter) : undefined))
		.orderBy(desc(highlights.createdAt))
		.limit(ARTICLES_VIEW_MAX)
	const articles = new Map<string, HighlightArticle>()
	for (const h of rows) {
		const article = articles.get(h.documentId)
		if (article) article.highlights.push(h)
		else
			articles.set(h.documentId, {
				documentId: h.documentId,
				documentTitle: h.documentTitle,
				author: h.author,
				siteName: h.siteName,
				sourceUrl: h.sourceUrl,
				highlights: [h],
				latestAt: h.createdAt,
			})
	}
	for (const article of articles.values())
		article.highlights.sort((a, b) => a.startOffset - b.startOffset)
	return [...articles.values()]
}

/** Matching highlights per filter (search applied), for the filter chips. */
export async function countHighlightFilters(
	userId: string,
	q?: string,
): Promise<Record<HighlightFilter, number>> {
	const [row] = await db
		.select(
			Object.fromEntries(
				HIGHLIGHT_FILTERS.map((f) => [f, sql<number>`count(*) filter (where ${filterWhere(f)})`]),
			) as Record<HighlightFilter, SQL<number>>,
		)
		.from(highlights)
		.innerJoin(documents, eq(documents.id, highlights.documentId))
		.where(baseWhere(userId, q))
	return Object.fromEntries(HIGHLIGHT_FILTERS.map((f) => [f, Number(row?.[f] ?? 0)])) as Record<
		HighlightFilter,
		number
	>
}
