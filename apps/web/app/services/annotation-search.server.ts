import { QUERY_MAX } from "@klipstack/api-contract/search-query"
import {
	and,
	db,
	desc,
	documents,
	eq,
	highlights,
	isNull,
	matchedWords,
	ownWords,
	prefixQuery,
	type SQL,
	searchQuery,
	sql,
	textConfigs,
	typedWords,
} from "@klipstack/db"
import { matchedIn, type Snippet, snippet, snippetText, startsWithAny } from "~/lib/search-snippet"
import { annotationScope } from "./search.server"

/**
 * Finding highlights and article notes: the search page's Highlights and Notes groups, and the
 * command palette. Both read the stored vectors that triggers keep current
 * (drizzle/0043_annotation_search.sql), through their GIN indexes. Only the user's own, never a
 * deleted highlight, and nothing of an article in the trash.
 */

/** Matches shown in each group on the search page. */
export const ANNOTATION_GROUP_LIMIT = 5
/** All of a group, when asked for: more than a page of results needs a better query. */
export const ANNOTATION_GROUP_MAX = 100

export interface HighlightHit {
	id: string
	documentId: string
	/** The title, or the address without one. */
	title: string
	siteName: string | null
	color: number
	quote: Snippet
	/** Null without a note. */
	note: Snippet | null
	createdAt: Date
}

export interface NoteHit {
	documentId: string
	title: string
	siteName: string | null
	note: Snippet
	noteUpdatedAt: Date | null
}

export interface Group<T> {
	items: T[]
	total: number
}

const QUOTE_SNIPPET = 280
const NOTE_SNIPPET = 200

const empty = <T>(): Group<T> => ({ items: [], total: 0 })

const title = sql<string>`coalesce(nullif(${documents.title}, ''), ${documents.sourceUrl})`
const liveHighlight = and(isNull(highlights.deletedAt), isNull(documents.deletedAt)) as SQL
const noteConfigs = textConfigs(sql`null::text`)

async function counted<T>(rows: Promise<T[]>, where: SQL, limit: number, from: "h" | "d") {
	const items = await rows
	if (items.length < limit) return { items, total: items.length }
	const count = db.select({ n: sql<number>`count(*)::int` })
	const [row] =
		from === "h"
			? await count
					.from(highlights)
					.innerJoin(documents, eq(documents.id, highlights.documentId))
					.where(where)
			: await count.from(documents).where(where)
	return { items, total: row?.n ?? items.length }
}

/**
 * Highlights whose quote or note has the query's words (as `searchDocuments` matches them: variants,
 * accents aside), in the articles the query's operators allow. Best matches first.
 */
export async function searchHighlights({
	userId,
	q,
	limit = ANNOTATION_GROUP_LIMIT,
	timeZone,
}: {
	userId: string
	q: string
	limit?: number
	timeZone?: string
}): Promise<Group<HighlightHit>> {
	const scope = annotationScope(userId, q, timeZone)
	if (!scope) return empty()
	const tsquery = searchQuery(scope.text)
	const own = ownWords(highlights.search)
	const where = and(
		eq(highlights.userId, userId),
		liveHighlight,
		scope.where,
		// The index finds the candidates; their own words decide (not the article's title).
		sql`${highlights.search} @@ ${tsquery}`,
		sql`${own} @@ ${tsquery}`,
	) as SQL
	const rows = db
		.select({
			id: highlights.id,
			documentId: highlights.documentId,
			title,
			siteName: documents.siteName,
			color: highlights.color,
			exact: highlights.exact,
			note: highlights.note,
			createdAt: highlights.createdAt,
			quoteWords: matchedWords(
				sql`${highlights.exact}`,
				tsquery,
				textConfigs(sql`${documents.language}`),
			),
			noteWords: matchedWords(sql`coalesce(${highlights.note}, '')`, tsquery, noteConfigs),
		})
		.from(highlights)
		.innerJoin(documents, eq(documents.id, highlights.documentId))
		.where(where)
		.orderBy(
			// Weights {D, C, B, A}: the quote and the note count, the article's words do not. Unlike
			// ts_rank_cd of the filtered vector, cheap enough for a word in every highlight.
			desc(sql`ts_rank('{0, 0, 0.4, 1}', ${highlights.search}, ${tsquery})`),
			desc(highlights.createdAt),
			desc(highlights.id),
		)
		.limit(limit)
	const { items, total } = await counted(rows, where, limit, "h")
	return {
		total,
		items: items.map(({ exact, note, quoteWords, noteWords, ...h }) => ({
			...h,
			quote: snippet(exact, matchedIn(quoteWords), QUOTE_SNIPPET),
			note: note ? snippet(note, matchedIn(noteWords), NOTE_SNIPPET) : null,
		})),
	}
}

/** Article notes with the query's words, in the articles the query's operators allow. */
export async function searchNotes({
	userId,
	q,
	limit = ANNOTATION_GROUP_LIMIT,
	timeZone,
}: {
	userId: string
	q: string
	limit?: number
	timeZone?: string
}): Promise<Group<NoteHit>> {
	const scope = annotationScope(userId, q, timeZone)
	if (!scope) return empty()
	const tsquery = searchQuery(scope.text)
	const where = and(scope.where, sql`${documents.noteSearch} @@ ${tsquery}`) as SQL
	const rows = db
		.select({
			documentId: documents.id,
			title,
			siteName: documents.siteName,
			note: documents.note,
			noteUpdatedAt: documents.noteUpdatedAt,
			words: matchedWords(sql`${documents.note}`, tsquery, noteConfigs),
		})
		.from(documents)
		.where(where)
		.orderBy(
			desc(sql`ts_rank_cd(${documents.noteSearch}, ${tsquery})`),
			sql`${documents.noteUpdatedAt} desc nulls last`,
			desc(documents.id),
		)
		.limit(limit)
	const { items, total } = await counted(rows, where, limit, "d")
	return {
		total,
		items: items.map(({ note, words, ...n }) => ({
			...n,
			note: snippet(note ?? "", matchedIn(words), NOTE_SNIPPET),
		})),
	}
}

const QUICK_SNIPPET = 120

export interface QuickHighlight {
	id: string
	documentId: string
	title: string
	quote: string
}

export interface QuickNote {
	documentId: string
	title: string
	note: string
}

/**
 * For the command palette: highlights whose quote or note, and article notes, have every typed
 * word, as typed or as the start of a longer word. Most recently changed first.
 */
export async function quickFindAnnotations({
	userId,
	q,
	limit = 5,
}: {
	userId: string
	q: string
	limit?: number
}): Promise<{ highlights: QuickHighlight[]; notes: QuickNote[] }> {
	const typed = q.replaceAll("\u0000", "").slice(0, QUERY_MAX)
	const words = typedWords(typed)
	if (words.length === 0) return { highlights: [], notes: [] }
	const matches = startsWithAny(words)
	const [found, noted] = await Promise.all([
		db
			.select({
				id: highlights.id,
				documentId: highlights.documentId,
				title,
				exact: highlights.exact,
				note: highlights.note,
			})
			.from(highlights)
			.innerJoin(documents, eq(documents.id, highlights.documentId))
			.where(
				and(
					eq(highlights.userId, userId),
					eq(documents.userId, userId),
					liveHighlight,
					sql`${highlights.search} @@ ${prefixQuery(typed, "ab")}`,
				),
			)
			.orderBy(desc(highlights.updatedAt), desc(highlights.id))
			.limit(limit),
		db
			.select({ documentId: documents.id, title, note: documents.note })
			.from(documents)
			.where(
				and(
					eq(documents.userId, userId),
					isNull(documents.deletedAt),
					sql`${documents.noteSearch} @@ ${prefixQuery(typed)}`,
				),
			)
			.orderBy(sql`${documents.noteUpdatedAt} desc nulls last`, desc(documents.id))
			.limit(limit),
	])
	return {
		highlights: found.map(({ exact, note, ...h }) => {
			// The quote, unless only the note has the words.
			const inQuote = snippet(exact, matches, QUICK_SNIPPET)
			const shown =
				inQuote.some((r) => r.match) || !note ? inQuote : snippet(note, matches, QUICK_SNIPPET)
			return { ...h, quote: snippetText(shown) }
		}),
		notes: noted.map(({ note, ...n }) => ({
			...n,
			note: snippetText(snippet(note ?? "", matches, QUICK_SNIPPET)),
		})),
	}
}
