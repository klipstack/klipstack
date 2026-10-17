import {
	and,
	asc,
	byName,
	db,
	desc,
	documents,
	documentTags,
	documentTopics,
	eq,
	highlights,
	inArray,
	isNull,
	lte,
	or,
	type SQL,
	type SQLWrapper,
	sql,
	tags,
	topics,
} from "@klipstack/db"
import { HIGHLIGHT_COLOR_NAMES } from "~/lib/highlight-colors"
import type { HighlightFilter } from "~/lib/highlight-filters"
import { type NotebookFilter, showsArticleNotes } from "~/lib/notebook-filters"
import {
	baseWhere,
	filterWhere,
	type HighlightListItem,
	type HighlightScope,
	listColumns,
	matchingWhere,
	scopeWhere,
	termsMatch,
} from "./highlights.server"

/**
 * The Notebook: everything a reader kept from what they read, their highlights (with their notes)
 * and their article notes, together. By article, as one stream, by topic, or a random hand;
 * searched, filtered and narrowed the same way throughout. Only the reader's own: never a deleted
 * highlight, nor anything of an article in the trash.
 */

export interface NotebookMatching {
	userId: string
	/** Every word somewhere: a highlight's quote, note or article; an article note's own words. */
	q?: string
	filter?: NotebookFilter | null
	scope?: HighlightScope
}

/** What a note's card, or an article's heading, shows of the article. */
export interface NotebookArticleFields {
	documentId: string
	documentTitle: string | null
	author: string | null
	siteName: string | null
	sourceUrl: string
	/** The lead image, as an address to show; null without one. */
	image: string | null
}

export interface ArticleNote extends NotebookArticleFields {
	note: string
	/** When the note was last saved; what a save in place sends back as `expectedUpdatedAt`. */
	noteUpdatedAt: Date | null
	/** When it was last written: its save, or for an imported note, when the article was saved. */
	writtenAt: Date
}

/** A card on the page: a highlight, or an article's note. */
export type NotebookItem =
	| ({ kind: "highlight" } & HighlightListItem)
	| ({ kind: "note" } & ArticleNote)

export interface NotebookCursor {
	at: string
	id: string
}

const articleColumns = {
	documentId: documents.id,
	documentTitle: documents.title,
	author: documents.author,
	siteName: documents.siteName,
	sourceUrl: documents.sourceUrl,
	image: listColumns.image,
}

/** A note that never went through a save (an import) was written when its article was saved. */
const writtenAt = sql`coalesce(${documents.noteUpdatedAt}, ${documents.createdAt})`

const noteColumns = {
	...articleColumns,
	note: sql<string>`${documents.note}`,
	noteUpdatedAt: documents.noteUpdatedAt,
	writtenAt: sql<Date>`${writtenAt}`.mapWith(documents.createdAt),
}

/** A time to the microsecond, for a cursor: a JavaScript Date would drop the last three digits. */
const exactTime = (time: SQL) =>
	sql<string>`to_char(${time} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

const hasNote = sql`btrim(coalesce(${documents.note}, '')) <> ''`

const asHighlightFilter = (filter: NotebookFilter | null | undefined): HighlightFilter | null =>
	filter === "highlights" ? null : (filter ?? null)

function highlightWhere(m: NotebookMatching) {
	return matchingWhere(m.userId, { q: m.q, filter: asHighlightFilter(m.filter), scope: m.scope })
}

/** The matching article notes; null when the filter shows none (Highlights, a color). */
function noteWhere(m: NotebookMatching): SQL | null {
	if (!showsArticleNotes(m.filter ?? null)) return null
	return and(
		eq(documents.userId, m.userId),
		isNull(documents.deletedAt),
		hasNote,
		termsMatch(documents.noteSearch, m.q),
		scopeWhere(m.scope),
	) as SQL
}

const olderThan = (time: SQL, id: SQLWrapper, cursor: NotebookCursor | null) =>
	cursor ? sql`(${time}, ${id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)` : undefined

/** Newest first; the same time (rare) by id, as the database orders them. */
const newestFirst = (a: NotebookCursor, b: NotebookCursor) =>
	a.at === b.at ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) : a.at < b.at ? 1 : -1

const asNote = <T extends { note: string }>(n: T) => ({ kind: "note" as const, ...n })
const asHighlight = <T extends HighlightListItem>(h: T) => ({ kind: "highlight" as const, ...h })

export const NOTEBOOK_PAGE_SIZE = 50

/**
 * The stream: highlights as they were made and notes as they were last written, newest first, a
 * page at a time. Each kind reads its next page from the cursor; together they make one.
 */
export async function listNotebookStream({
	cursor = null,
	limit = NOTEBOOK_PAGE_SIZE,
	...m
}: NotebookMatching & { cursor?: NotebookCursor | null; limit?: number }): Promise<{
	items: NotebookItem[]
	nextCursor: NotebookCursor | null
}> {
	const notes = noteWhere(m)
	const createdAt = sql`${highlights.createdAt}`
	const [found, noted] = await Promise.all([
		db
			.select({ ...listColumns, at: exactTime(createdAt) })
			.from(highlights)
			.innerJoin(documents, eq(documents.id, highlights.documentId))
			.where(and(highlightWhere(m), olderThan(createdAt, highlights.id, cursor)))
			.orderBy(desc(highlights.createdAt), desc(highlights.id))
			.limit(limit + 1),
		notes
			? db
					.select({ ...noteColumns, at: exactTime(writtenAt) })
					.from(documents)
					.where(and(notes, olderThan(writtenAt, documents.id, cursor)))
					.orderBy(desc(writtenAt), desc(documents.id))
					.limit(limit + 1)
			: [],
	])
	const merged = [
		...found.map(({ at, ...h }) => ({ at, id: h.id, item: asHighlight(h) as NotebookItem })),
		...noted.map(({ at, ...n }) => ({ at, id: n.documentId, item: asNote(n) as NotebookItem })),
	].sort(newestFirst)
	const page = merged.slice(0, limit)
	const last = page.at(-1)
	return {
		items: page.map((x) => x.item),
		nextCursor: merged.length > limit && last ? { at: last.at, id: last.id } : null,
	}
}

export interface NotebookArticle extends NotebookArticleFields {
	/** Its note, matching or not: the article's own words beside its highlights. */
	note: string | null
	noteUpdatedAt: Date | null
	/** The matching highlights, in reading order. */
	highlights: HighlightListItem[]
}

export const NOTEBOOK_ARTICLES_PAGE_SIZE = 20

/**
 * By article: the articles with a matching highlight or note, by their latest activity (their
 * newest highlight, or their note's last edit), a page at a time. Each holds its note and its
 * matching highlights.
 */
export async function listNotebookArticles({
	cursor = null,
	limit = NOTEBOOK_ARTICLES_PAGE_SIZE,
	...m
}: NotebookMatching & { cursor?: NotebookCursor | null; limit?: number }): Promise<{
	articles: NotebookArticle[]
	nextCursor: NotebookCursor | null
}> {
	const highlightFilter = asHighlightFilter(m.filter)
	const matches =
		and(
			termsMatch(highlights.search, m.q),
			highlightFilter ? filterWhere(highlightFilter) : undefined,
		) ?? sql`true`
	// Every article's highlights at once: when the newest was made, and how many match.
	const highlighted = db
		.select({
			documentId: sql<string>`${highlights.documentId}`.as("highlighted_id"),
			latest: sql`max(${highlights.createdAt})`.as("latest"),
			matched: sql<number>`count(*) filter (where ${matches})`.as("matched"),
		})
		.from(highlights)
		.innerJoin(documents, eq(documents.id, highlights.documentId))
		.where(baseWhere(m.userId, undefined, m.scope))
		.groupBy(highlights.documentId)
		.as("highlighted")
	const notes = noteWhere(m)
	const someMatch = sql`${highlighted.matched} > 0`
	const activity = sql`greatest(${highlighted.latest}, case when ${hasNote} then ${writtenAt} end)`
	const rows = await db
		.select({
			...articleColumns,
			note: documents.note,
			noteUpdatedAt: documents.noteUpdatedAt,
			at: exactTime(activity),
		})
		.from(documents)
		.leftJoin(highlighted, eq(highlighted.documentId, documents.id))
		.where(
			and(
				eq(documents.userId, m.userId),
				isNull(documents.deletedAt),
				notes ? or(someMatch, notes) : someMatch,
				olderThan(activity, documents.id, cursor),
			),
		)
		.orderBy(desc(activity), desc(documents.id))
		.limit(limit + 1)
	const page = rows.slice(0, limit)
	const ids = page.map((a) => a.documentId)
	const found = ids.length
		? await db
				.select(listColumns)
				.from(highlights)
				.innerJoin(documents, eq(documents.id, highlights.documentId))
				.where(and(highlightWhere(m), inArray(highlights.documentId, ids)))
				.orderBy(asc(highlights.startOffset), asc(highlights.createdAt))
		: []
	const byArticle = new Map<string, HighlightListItem[]>(ids.map((id) => [id, []]))
	for (const h of found) byArticle.get(h.documentId)?.push(h)
	const last = page.at(-1)
	return {
		articles: page.map(({ at: _at, note, ...a }) => ({
			...a,
			note: note?.trim() ? note : null,
			highlights: byArticle.get(a.documentId) ?? [],
		})),
		nextCursor: rows.length > limit && last ? { at: last.at, id: last.documentId } : null,
	}
}

export interface NotebookTopicGroup {
	/** Null: the articles in none of the reader's topics. */
	topicId: string | null
	name: string | null
	/** Matching highlights and notes under the topic, all of them; `items` holds the newest few. */
	highlights: number
	notes: number
	items: NotebookItem[]
}

/** The newest cards a topic shows on the page; the rest are a click away. */
export const TOPIC_GROUP_SIZE = 6

/** The reader's articles in their active topics, as sorted (not suggested, not refused). */
function placedIn(userId: string) {
	return db
		.select({
			documentId: documentTopics.documentId,
			topicId: sql<string>`${topics.id}`.as("topic_id"),
			topicName: sql<string>`${topics.name}`.as("topic_name"),
		})
		.from(documentTopics)
		.innerJoin(topics, eq(topics.id, documentTopics.topicId))
		.where(
			and(
				eq(topics.userId, userId),
				eq(topics.status, "active"),
				eq(documentTopics.level, "applied"),
				isNull(documentTopics.refusedAt),
			),
		)
		.as("placed")
}

/**
 * Matching highlights and notes under their articles' topics: an article listed under two topics
 * shows under both, as the library's topic filter lists it under both. Articles in none (not
 * sorted yet, or sorted into none) are the last group. Each group holds its newest `perTopic`, in
 * a query per kind however large the library: the database counts and ranks them. Topics with
 * the most first.
 */
export async function listNotebookTopics({
	perTopic = TOPIC_GROUP_SIZE,
	...m
}: NotebookMatching & { perTopic?: number }): Promise<NotebookTopicGroup[]> {
	const placed = placedIn(m.userId)
	const group = {
		topicId: sql<string | null>`${placed.topicId}`.as("group_id"),
		topicName: sql<string | null>`${placed.topicName}`.as("group_name"),
		total: sql<number>`count(*) over (partition by ${placed.topicId})`.as("total"),
	}
	const rankedHighlights = db
		.select({
			...listColumns,
			image: listColumns.image.as("image"),
			...group,
			rank: sql<number>`row_number() over (partition by ${placed.topicId} order by ${highlights.createdAt} desc, ${highlights.id} desc)`.as(
				"rank",
			),
		})
		.from(highlights)
		.innerJoin(documents, eq(documents.id, highlights.documentId))
		.leftJoin(placed, eq(placed.documentId, highlights.documentId))
		.where(highlightWhere(m))
		.as("ranked_highlights")
	const notes = noteWhere(m)
	const rankedNotes = db
		.select({
			...noteColumns,
			image: listColumns.image.as("image"),
			note: noteColumns.note.as("note"),
			writtenAt: noteColumns.writtenAt.as("written_at"),
			...group,
			rank: sql<number>`row_number() over (partition by ${placed.topicId} order by ${writtenAt} desc, ${documents.id} desc)`.as(
				"rank",
			),
		})
		.from(documents)
		.leftJoin(placed, eq(placed.documentId, documents.id))
		.where(notes ?? sql`false`)
		.as("ranked_notes")
	const [found, noted] = await Promise.all([
		db.select().from(rankedHighlights).where(lte(rankedHighlights.rank, perTopic)),
		notes ? db.select().from(rankedNotes).where(lte(rankedNotes.rank, perTopic)) : [],
	])
	const groups = new Map<
		string | null,
		Omit<NotebookTopicGroup, "items"> & { cards: Array<{ at: Date; item: NotebookItem }> }
	>()
	const groupOf = (topicId: string | null, name: string | null) => {
		let g = groups.get(topicId)
		if (!g) groups.set(topicId, (g = { topicId, name, highlights: 0, notes: 0, cards: [] }))
		return g
	}
	for (const { topicId, topicName, rank: _rank, total, ...h } of found) {
		const g = groupOf(topicId, topicName)
		g.highlights = Number(total)
		g.cards.push({ at: h.createdAt, item: asHighlight(h) })
	}
	for (const { topicId, topicName, rank: _rank, total, ...n } of noted) {
		const g = groupOf(topicId, topicName)
		g.notes = Number(total)
		g.cards.push({ at: n.writtenAt, item: asNote(n) })
	}
	return [...groups.values()]
		.map(({ cards, ...g }) => ({
			...g,
			items: cards
				.sort((a, b) => b.at.getTime() - a.at.getTime())
				.slice(0, perTopic)
				.map((c) => c.item),
		}))
		.sort(
			(a, b) =>
				Number(a.topicId === null) - Number(b.topicId === null) ||
				b.highlights + b.notes - (a.highlights + a.notes) ||
				(a.name ?? "").localeCompare(b.name ?? ""),
		)
}

/** How many cards Shuffle deals. */
export const HAND_SIZE = 12

/**
 * A random hand of matching highlights and notes. The seed decides it: the same seed deals the
 * same hand (less any deleted since), so the page stays put when it reloads after a change; a new
 * seed deals again.
 */
export async function dealNotebook({
	seed,
	size = HAND_SIZE,
	...m
}: NotebookMatching & { seed: string; size?: number }): Promise<NotebookItem[]> {
	const highlightCard = sql<string>`md5(${highlights.id}::text || ${seed}) collate "C"`
	const noteCard = sql<string>`md5(${documents.id}::text || ${seed}) collate "C"`
	const notes = noteWhere(m)
	const [found, noted] = await Promise.all([
		db
			.select({ ...listColumns, card: highlightCard })
			.from(highlights)
			.innerJoin(documents, eq(documents.id, highlights.documentId))
			.where(highlightWhere(m))
			.orderBy(highlightCard)
			.limit(size),
		notes
			? db
					.select({ ...noteColumns, card: noteCard })
					.from(documents)
					.where(notes)
					.orderBy(noteCard)
					.limit(size)
			: [],
	])
	return [
		...found.map(({ card, ...h }) => ({ card, item: asHighlight(h) as NotebookItem })),
		...noted.map(({ card, ...n }) => ({ card, item: asNote(n) as NotebookItem })),
	]
		.sort((a, b) => (a.card < b.card ? -1 : a.card > b.card ? 1 : 0))
		.slice(0, size)
		.map((c) => c.item)
}

export type NotebookCounts = Record<"all" | NotebookFilter, number>

/** What each filter would show (search and scope applied), for the filter chips. */
export async function countNotebook(
	userId: string,
	q?: string,
	scope?: HighlightScope,
): Promise<NotebookCounts> {
	const count = (where?: SQL) =>
		where ? sql<number>`count(*) filter (where ${where})::int` : sql<number>`count(*)::int`
	const [[h], [n]] = await Promise.all([
		db
			.select({
				total: count(),
				notes: count(filterWhere("notes")),
				shared: count(filterWhere("shared")),
				...Object.fromEntries(HIGHLIGHT_COLOR_NAMES.map((c) => [c, count(filterWhere(c))])),
			})
			.from(highlights)
			.innerJoin(documents, eq(documents.id, highlights.documentId))
			.where(baseWhere(userId, q, scope)),
		db
			.select({ notes: count() })
			.from(documents)
			.where(noteWhere({ userId, q, scope }) as SQL),
	])
	const of = (key: string) => Number((h as Record<string, unknown> | undefined)?.[key] ?? 0)
	const articleNotes = Number(n?.notes ?? 0)
	return {
		all: of("total") + articleNotes,
		notes: of("notes") + articleNotes,
		highlights: of("total"),
		shared: of("shared"),
		...(Object.fromEntries(HIGHLIGHT_COLOR_NAMES.map((c) => [c, of(c)])) as Record<
			(typeof HIGHLIGHT_COLOR_NAMES)[number],
			number
		>),
	}
}

export interface NotebookTag {
	id: string
	name: string
	/** The highlights and notes kept from articles with the tag. */
	count: number
}

/** The reader's tags whose live articles have highlights or a note, by name: the tag menu. */
export async function listNotebookTags(userId: string): Promise<NotebookTag[]> {
	const kept = sql<number>`(count(${highlights.id}) + count(distinct ${documents.id}) filter (where ${hasNote}))::int`
	const rows = await db
		.select({ id: tags.id, name: tags.name, count: kept })
		.from(tags)
		.innerJoin(documentTags, eq(documentTags.tagId, tags.id))
		.innerJoin(
			documents,
			and(
				eq(documents.id, documentTags.documentId),
				eq(documents.userId, userId),
				isNull(documents.deletedAt),
			),
		)
		.leftJoin(
			highlights,
			and(
				eq(highlights.documentId, documents.id),
				eq(highlights.userId, userId),
				isNull(highlights.deletedAt),
			),
		)
		.where(eq(tags.userId, userId))
		.groupBy(tags.id, tags.name)
		.having(sql`${kept} > 0`)
		.orderBy(byName(tags.name))
	return rows.map((r) => ({ ...r, count: Number(r.count) }))
}

/** The name of one of the user's active topics, for the topic the page narrows to; null otherwise. */
export async function activeTopicName(userId: string, id: string): Promise<string | null> {
	const [row] = await db
		.select({ name: topics.name })
		.from(topics)
		.where(and(eq(topics.id, id), eq(topics.userId, userId), eq(topics.status, "active")))
	return row?.name ?? null
}
