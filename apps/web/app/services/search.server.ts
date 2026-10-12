import type { SearchIs, SearchLocation, SearchSort } from "@klipstack/api-contract/enums"
import {
	type DatePoint,
	type Filter,
	parseSearchQuery,
	QUERY_MAX,
	SEARCH_OFFSET_MAX,
	type SearchQuery,
} from "@klipstack/api-contract/search-query"
import {
	byName,
	and,
	anyWordQuery,
	asc,
	db,
	desc,
	documents,
	eq,
	exists,
	fallbackWords,
	highlights,
	isNotNull,
	isNull,
	matchedWordCount,
	ne,
	or,
	type SQL,
	searchQuery,
	sql,
	tags,
	textSearchVector,
} from "@klipstack/db"
import { isTimeZone } from "~/lib/date-groups"
import {
	finished,
	INBOX_FILTER_WHERE,
	libraryCardColumns as cardColumns,
	type LibraryCard,
	long,
	quick,
	SORT_KEY,
} from "./documents.server"
import { articleHasTag, tagArticleCount } from "./tags.server"
import { articleInTopic, topicNames } from "./topics.server"

export const SEARCH_LIMIT = 30
/** Matches in the trash shown under the results. */
const TRASH_GROUP_LIMIT = 5

/** What the link menu offers before anything is typed: last read, then last saved. */
export async function recentDocuments({
	userId,
	limit = 8,
	exclude,
}: {
	userId: string
	limit?: number
	exclude?: string | null
}): Promise<LibraryCard[]> {
	return db
		.select(cardColumns)
		.from(documents)
		.where(
			and(
				eq(documents.userId, userId),
				isNull(documents.deletedAt),
				exclude ? ne(documents.id, exclude) : undefined,
			),
		)
		.orderBy(sql`${documents.lastReadAt} desc nulls last`, desc(documents.createdAt))
		.limit(limit)
}

export interface TrashMatches {
	items: LibraryCard[]
	total: number
}

export interface SearchResult {
	items: LibraryCard[]
	/** Null on the last page. */
	nextOffset: number | null
	/** The operators the query language did not understand, as typed. */
	ignored: string[]
	/** Matches in the trash, when the query did not say where to look. First page only. */
	trash: TrashMatches | null
}

const notDeleted = isNull(documents.deletedAt)

const LOCATION_WHERE: Record<SearchLocation, SQL> = {
	library: and(notDeleted, isNull(documents.archivedAt)) as SQL,
	archive: and(notDeleted, isNotNull(documents.archivedAt)) as SQL,
	trash: isNotNull(documents.deletedAt),
	anywhere: sql`true`,
}

/** Postgres text cannot hold NUL, and it means nothing in a search. */
const parse = (q: string) => parseSearchQuery(q.replaceAll("\u0000", "").trim())

/** Which of an article out of the trash, archived or not, each place holds. */
const LOCATION_HOLDS: Record<SearchLocation, (archived: boolean) => boolean> = {
	library: (archived) => !archived,
	archive: (archived) => archived,
	trash: () => false,
	anywhere: () => true,
}

/**
 * The results hold archived and unarchived articles alike: archiving one leaves it among them.
 * Without an `in:`, they are the inbox and the archive.
 */
export function keepsArchived(q: string): boolean {
	const places = parse(q).filters.filter((f) => f.key === "in")
	const holds = (archived: boolean) =>
		places.every((f) => !f.negated || !LOCATION_HOLDS[f.value](archived)) &&
		(places.every((f) => f.negated) ||
			places.some((f) => !f.negated && LOCATION_HOLDS[f.value](archived)))
	return holds(true) && holds(false)
}

/** Unlike the inbox chips, quick and long do not leave out what is read. */
const IS_WHERE: Record<SearchIs, SQL> = {
	starred: isNotNull(documents.starredAt),
	shortlisted: isNotNull(documents.shortlistedAt),
	unread: INBOX_FILTER_WHERE.unread,
	reading: INBOX_FILTER_WHERE.progress,
	finished,
	quick,
	long,
	failed: eq(documents.status, "failed"),
}

/** Case and accents do not matter; `%` and `_` match themselves. */
function contains(column: SQL, value: string): SQL {
	const pattern = `%${value.replace(/[\\%_]/g, "\\$&")}%`
	return sql`unaccent(${column}) ilike unaccent(${pattern})`
}

/** Words of a quick find that count; the palette is for a few of them. */
const QUICK_WORDS_MAX = 8

/**
 * Quick open, for the command palette and the note link menu: every word must be in the title,
 * the site, the author or the address, as far as it is typed ("sched" finds "Schedule"). Not a
 * search: no body, no operators, no trash. Titles that have all the words first, then last read.
 */
export async function quickFind({
	userId,
	q,
	limit = 12,
	exclude,
}: {
	userId: string
	q: string
	limit?: number
	exclude?: string | null
}): Promise<LibraryCard[]> {
	const words = q
		.replaceAll("\u0000", "")
		.slice(0, QUERY_MAX)
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, QUICK_WORDS_MAX)
	if (words.length === 0) return []
	const inTitle = and(...words.map((word) => contains(sql`${documents.title}`, word))) as SQL
	return db
		.select(cardColumns)
		.from(documents)
		.where(
			and(
				eq(documents.userId, userId),
				notDeleted,
				exclude ? ne(documents.id, exclude) : undefined,
				...words.map((word) =>
					or(
						contains(sql`${documents.title}`, word),
						contains(sql`${documents.siteName}`, word),
						contains(sql`${documents.author}`, word),
						contains(sql`${documents.sourceUrl}`, word),
					),
				),
			),
		)
		.orderBy(
			desc(sql`coalesce(${inTitle}, false)`),
			sql`${documents.lastReadAt} desc nulls last`,
			desc(documents.createdAt),
		)
		.limit(limit)
}

const urlHost = sql`substring(${documents.sourceUrl} from '^[a-zA-Z]+://([^/:?#]+)')`

/**
 * What the search field offers after `site:`, `author:`, `tag:` or `topic:`: the library's own values that
 * contain what is typed, most articles first. A site is its address without "www.": no spaces, and just
 * what `site:` will match.
 */
export async function operatorValues({
	userId,
	key,
	q,
	limit = 8,
}: {
	userId: string
	key: "site" | "author" | "tag" | "topic"
	q: string
	limit?: number
}): Promise<string[]> {
	const typed = q.replaceAll("\u0000", "").trim().slice(0, QUERY_MAX)
	if (key === "topic") return topicNames(userId, typed, limit)
	if (key === "tag") {
		// A tag with no articles is still a tag; it comes last.
		const rows = await db
			.select({ name: tags.name })
			.from(tags)
			.where(and(eq(tags.userId, userId), typed ? contains(sql`${tags.name}`, typed) : undefined))
			.orderBy(desc(tagArticleCount), byName(tags.name))
			.limit(limit)
		return rows.map((r) => r.name)
	}
	const value =
		key === "site"
			? sql<string>`regexp_replace(lower(${urlHost}), '^www\\.', '')`
			: sql<string>`${documents.author}`
	const rows = await db
		.select({ value })
		.from(documents)
		.where(
			and(
				eq(documents.userId, userId),
				notDeleted,
				sql`nullif(${value}, '') is not null`,
				typed ? contains(value, typed) : undefined,
			),
		)
		.groupBy(value)
		.orderBy(desc(sql`count(*)`), value)
		.limit(limit)
	return rows.map((r) => r.value)
}

/** The zone for the SQL: a name (`isTimeZone`), or UTC. */
function zoneName(timeZone: string): string {
	return isTimeZone(timeZone) ? timeZone : "UTC"
}

const AGO_FIELD = { d: "days", w: "weeks", m: "months", y: "years" } as const

function datePoint(point: DatePoint, zone: string): SQL {
	if ("date" in point) return sql`${point.date}::date`
	const field = sql.raw(AGO_FIELD[point.unit])
	return sql`((now() at time zone ${zone})::date - make_interval(${field} => ${point.ago}::int))::date`
}

function filterWhere(filter: Filter, zone: string): SQL {
	switch (filter.key) {
		case "in":
			return LOCATION_WHERE[filter.value]
		case "is":
			return IS_WHERE[filter.value]
		case "has":
			if (filter.value === "tags") return articleHasTag()
			if (filter.value === "topic") return articleInTopic()
			return filter.value === "note"
				? (and(isNotNull(documents.note), ne(documents.note, "")) as SQL)
				: exists(
						db
							.select({ one: sql`1` })
							.from(highlights)
							.where(and(eq(highlights.documentId, documents.id), isNull(highlights.deletedAt))),
					)
		case "site":
			return or(
				contains(sql`${documents.siteName}`, filter.value),
				contains(urlHost, filter.value),
			) as SQL
		case "author":
			return contains(sql`${documents.author}`, filter.value)
		case "title":
			return contains(sql`${documents.title}`, filter.value)
		case "tag":
			return articleHasTag(filter.value)
		case "topic":
			return articleInTopic(filter.value)
		case "via":
			return eq(documents.captureSource, filter.value)
		case "saved":
		case "published": {
			const column = filter.key === "saved" ? documents.createdAt : documents.publishedAt
			const day = sql`(${column} at time zone ${zone})::date`
			const { from, to } = filter.value
			return and(
				from ? sql`${day} >= ${datePoint(from, zone)}` : undefined,
				to ? sql`${day} < ${datePoint(to, zone)}` : undefined,
			) as SQL
		}
	}
}

/**
 * An article is in one place, from one site, by one author, and in a topic or two: repeats of these
 * widen the search.
 */
const OR_KEYS: ReadonlySet<Filter["key"]> = new Set(["in", "site", "author", "via", "topic"])

/**
 * The query's filters as conditions. Without an `in:`, the inbox and the archive. `inTrash` looks
 * in the trash instead, for the group under the results.
 */
function filtersWhere(filters: Filter[], zone: string, inTrash: boolean): SQL[] {
	const conditions: SQL[] = []
	const widened = new Map<Filter["key"], SQL[]>()
	for (const filter of filters) {
		const where = filterWhere(filter, zone)
		// A column with no value is not a match, so its negation is one.
		if (filter.negated) conditions.push(sql`not coalesce(${where}, false)`)
		else if (OR_KEYS.has(filter.key)) {
			widened.set(filter.key, [...(widened.get(filter.key) ?? []), where])
		} else conditions.push(where)
	}
	for (const alternatives of widened.values()) conditions.push(or(...alternatives) as SQL)
	if (inTrash) conditions.push(LOCATION_WHERE.trash)
	else if (!widened.has("in")) conditions.push(notDeleted)
	return conditions
}

/** Ties break by when the article was saved, then by id, so that pages do not overlap. */
function sortOrder(sort: Exclude<SearchSort, "relevance">): SQL[] {
	const { key, dir } = SORT_KEY[sort]
	const direction = dir === "asc" ? asc : desc
	return [...(key ? [key] : []), documents.createdAt, documents.id].map((c) => direction(c))
}

// The note may not be in the article's language: both app languages, like an unknown one.
const noteVector = sql`setweight(${textSearchVector(sql`${documents.note}`, sql`null::text`)}, 'B')`
const vector = sql`(coalesce(${documents.search}, ''::tsvector) || ${noteVector})`

/**
 * Articles whose words match `tsquery`: in the stored vector (title, author, body) or in the note.
 * Written as `vector @@ tsquery`, Postgres would decompress the stored vector of every article in
 * scope, tens of kilobytes each, on every search. The subquery finds the stored matches once,
 * through the vector's GIN index, and each row is then a hash lookup. The note's vector is built
 * only for articles that have one.
 */
function wordsMatch(userId: string, tsquery: SQL): SQL {
	return or(
		sql`${documents.id} in (select d.id from ${documents} d where d.user_id = ${userId} and d.search @@ ${tsquery})`,
		sql`(${documents.note} is not null and ${noteVector} @@ ${tsquery})`,
	) as SQL
}

/**
 * One page of the articles in `scope` that match the query's words, and the condition that found
 * them. When no article has all the words, the ones with the most of them.
 */
async function findPage(
	userId: string,
	query: SearchQuery,
	scope: SQL,
	limit: number,
	offset: number,
): Promise<{ rows: LibraryCard[]; where: SQL }> {
	const select = (where: SQL, order: SQL[]) =>
		db
			.select(cardColumns)
			.from(documents)
			.where(where)
			.orderBy(...order)
			.limit(limit)
			.offset(offset)
	const sort = query.sort ?? "relevance"
	// Without words the sort is all the order there is; relevance needs words.
	if (!query.text) {
		const order = sortOrder(sort === "relevance" ? "newest" : sort)
		return { rows: await select(scope, order), where: scope }
	}
	const tsquery = searchQuery(query.text)
	const all = and(
		scope,
		or(
			wordsMatch(userId, tsquery),
			contains(sql`${documents.title}`, query.text),
			contains(sql`${documents.sourceUrl}`, query.text),
		),
	) as SQL
	const rows = await select(
		all,
		sort === "relevance"
			? [desc(sql`coalesce(ts_rank_cd(${vector}, ${tsquery}), 0)`), ...sortOrder("newest")]
			: sortOrder(sort),
	)
	const words = rows.length === 0 ? fallbackWords(query.text) : []
	if (words.length === 0) return { rows, where: all }
	// Past the last page of full matches: not a search without any.
	if (offset > 0) {
		const [any] = await db.select({ id: documents.id }).from(documents).where(all).limit(1)
		if (any) return { rows, where: all }
	}
	const anyWord = anyWordQuery(words)
	const some = and(scope, wordsMatch(userId, anyWord)) as SQL
	return {
		rows: await select(
			some,
			sort === "relevance"
				? [
						desc(matchedWordCount(vector, words)),
						desc(sql`ts_rank(${vector}, ${anyWord})`),
						...sortOrder("newest"),
					]
				: sortOrder(sort),
		),
		where: some,
	}
}

/**
 * Searches the library with the query language of `@klipstack/api-contract/search-query`: words
 * (full-text over title, author, body and the note, plus a title and URL substring) and operators.
 * Accents never matter and words match their variants ("blocked" finds "blocking"). When no
 * article has all the words, the ones with the most of them come back.
 */
export async function searchDocuments({
	userId,
	q,
	limit = SEARCH_LIMIT,
	offset = 0,
	timeZone = "UTC",
}: {
	userId: string
	q: string
	limit?: number
	offset?: number
	/** Where the user's days start and end, for the date operators. */
	timeZone?: string
}): Promise<SearchResult> {
	const query = parse(q)
	const nothing = { items: [], nextOffset: null, ignored: query.ignored, trash: null }
	if (!query.text && query.filters.length === 0) return nothing
	const zone = zoneName(timeZone)
	const start = Math.min(Math.max(0, offset), SEARCH_OFFSET_MAX)
	const scope = (inTrash: boolean) =>
		and(eq(documents.userId, userId), ...filtersWhere(query.filters, zone, inTrash)) as SQL
	const { rows } = await findPage(userId, query, scope(false), limit + 1, start)
	const more = rows.length > limit && start + limit <= SEARCH_OFFSET_MAX
	const result: SearchResult = {
		...nothing,
		items: rows.slice(0, limit),
		nextOffset: more ? start + limit : null,
	}
	if (start > 0 || query.filters.some((f) => f.key === "in")) return result
	const trashed = await findPage(userId, query, scope(true), TRASH_GROUP_LIMIT, 0)
	if (trashed.rows.length === 0) return result
	const [count] =
		trashed.rows.length < TRASH_GROUP_LIMIT
			? [{ n: trashed.rows.length }]
			: await db
					.select({ n: sql<number>`count(*)::int` })
					.from(documents)
					.where(trashed.where)
	return { ...result, trash: { items: trashed.rows, total: count?.n ?? trashed.rows.length } }
}
