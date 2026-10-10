import { type SQL, sql } from "drizzle-orm"

/** Characters of body text that go into the `documents.search` vector (weight D). */
export const SEARCH_TEXT_MAX = 400_000

/**
 * Characters of a text that also get stemmed. A tsvector holds 1MB: the exact words of
 * SEARCH_TEXT_MAX characters plus two stemmed copies of this many fit even when no word repeats.
 * Past it, a long article is found by its exact words only.
 */
export const STEM_TEXT_MAX = 100_000

/** Postgres text search configs for the article languages we can stem. */
export const STEM_CONFIGS: Record<string, string> = {
	en: "english",
	es: "spanish",
	pt: "portuguese",
	fr: "french",
	it: "italian",
	de: "german",
	nl: "dutch",
}
/** Most articles have no language on record: try the app's two languages. */
export const FALLBACK_STEM_CONFIGS = ["english", "spanish"]

/** A query cannot know the language of what it will find: it tries every config. */
const QUERY_CONFIGS = ["simple", ...Object.values(STEM_CONFIGS)]

/** Config names come from the constants above, never from input. */
const regconfig = (name: string) => sql.raw(`'${name}'::regconfig`)

const orQueries = (queries: SQL[]) => sql.join(queries, sql` || `)

/**
 * Concatenated vectors are adjacent: the last word of one would sit next to the first word of the
 * next, and "compass orbital" would find "orbital compass". A placeholder lexeme pushes the next
 * vector's positions away, further than any phrase query reaches; ts_delete then removes it.
 */
const GAP = sql.raw(`'_:16'::tsvector`)

/**
 * Search vector for one text: its exact words, then their variants ("blocked" finds "blocking")
 * in the text's language, or in both app languages when `language` is not one we can stem.
 * Accents never matter. `text` and `language` are repeated in the SQL: pass columns, not values.
 */
export function textSearchVector(text: SQL, language: SQL): SQL {
	const plain = sql`unaccent(coalesce(${text}, ''))`
	const stemmed = sql`left(${plain}, ${sql.raw(String(STEM_TEXT_MAX))})`
	const known = Object.entries(STEM_CONFIGS).map(
		([lang, config]) =>
			sql`when ${sql.raw(`'${lang}'`)} then to_tsvector(${regconfig(config)}, ${stemmed})`,
	)
	const fallback = sql.join(
		FALLBACK_STEM_CONFIGS.map((config) => sql`to_tsvector(${regconfig(config)}, ${stemmed})`),
		sql` || ${GAP} || `,
	)
	return sql`ts_delete(to_tsvector('simple'::regconfig, ${plain}) || ${GAP} || case ${language} ${sql.join(known, sql` `)} else ${fallback} end, '_')`
}

/**
 * The `documents.search` vector: title (A), author (B), body (D). Every place that writes the
 * column builds it here. The backfill in drizzle/0016_search_stemming.sql repeats it in SQL.
 */
export function documentSearchVector(fields: {
	title: SQL | string
	author: SQL | string | null
	body: SQL | string
	/** Two-letter code, or null. */
	language: SQL | string | null
}): SQL {
	const lang = sql`f.lang`
	return sql`(select setweight(${textSearchVector(sql`f.title`, lang)}, 'A')
		|| setweight(${textSearchVector(sql`f.author`, lang)}, 'B')
		|| setweight(${textSearchVector(sql`f.body`, lang)}, 'D')
		from (select (${fields.title})::text as title, (${fields.author})::text as author,
			left((${fields.body})::text, ${sql.raw(String(SEARCH_TEXT_MAX))}) as body,
			(${fields.language})::text as lang) f)`
}

/**
 * What the user typed, in web search syntax (quotes, or, -word), as a tsquery. All the words must
 * match: exactly, or as variants in one language we stem.
 */
export function searchQuery(q: string): SQL {
	const queries = QUERY_CONFIGS.map(
		(config) => sql`websearch_to_tsquery(${regconfig(config)}, p.q)`,
	)
	return sql`(select ${orQueries(queries)} from (select unaccent(${q}::text) as q) p)`
}

/**
 * The words of a query, for when no article has them all. Empty when the fallback would not
 * help (fewer than two words) or would override the user (quotes and -word ask for strictness).
 */
export function fallbackWords(q: string): string[] {
	if (/"|(^|\s)-\S/.test(q)) return []
	const words = [...new Set(q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
	return words.length < 2 ? [] : words
}

/**
 * Rows of cleaned words. unaccent can write a quote ("ŉ" is "'n"), which to_tsquery would read as
 * syntax. Stop words of either app language go: the exact-word lexemes hold them, so "the" would
 * match every article.
 */
function wordRows(words: string[]): SQL {
	return sql`(select w.word from unnest(string_to_array(regexp_replace(unaccent(${words.join(" ")}::text), '[''&|!():<>*]', '', 'g'), ' ')) w(word)
		where w.word <> ''
		and numnode(to_tsquery('english'::regconfig, w.word)) > 0
		and numnode(to_tsquery('spanish'::regconfig, w.word)) > 0)`
}

/** A tsquery that any of the words satisfies. Null (matches nothing) when only stop words remain. */
export function anyWordQuery(words: string[]): SQL {
	const queries = QUERY_CONFIGS.map((config) => sql`to_tsquery(${regconfig(config)}, s.words)`)
	return sql`(select ${orQueries(queries)} from (select string_agg(word, ' | ') as words from ${wordRows(words)} r) s)`
}

/** How many of the words the vector has: the fallback's first sort key. */
export function matchedWordCount(vector: SQL, words: string[]): SQL<number> {
	const queries = QUERY_CONFIGS.map((config) => sql`to_tsquery(${regconfig(config)}, r.word)`)
	return sql<number>`(select count(*)::int from ${wordRows(words)} r where ${vector} @@ (${orQueries(queries)}))`
}
