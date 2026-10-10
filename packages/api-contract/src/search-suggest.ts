/**
 * What the search field offers to complete: operator keys and their values, for the token under
 * the caret. Pure, and client-safe like `./search-query`.
 */
import { CAPTURE_SOURCES, SEARCH_HAS, SEARCH_IS, SEARCH_LOCATIONS, SEARCH_SORTS } from "./enums"
import { parseSearchQuery, SEARCH_KEYS, type SearchKey } from "./search-query"

export interface SuggestionItem {
	/**
	 * Replaces the token. A key ends with ":" and the list stays open for its values; a value ends
	 * with a space.
	 */
	insert: string
	/** i18n key of a short explanation, in `library`. */
	hint?: string
}

export interface RemoteValues {
	key: "site" | "author" | "tag"
	prefix: string
	negated: boolean
}

export interface Suggestions {
	/** The token under the caret, to replace. */
	start: number
	end: number
	items: SuggestionItem[]
	/** The values come from the library: ask the server, then call `valueItems`. */
	remote?: RemoteValues
}

/** Dates and the sort cannot be negated. */
const NOT_NEGATED: ReadonlySet<SearchKey> = new Set([
	"saved",
	"published",
	"before",
	"after",
	"sort",
])

const FIXED_VALUES: Partial<Record<SearchKey, readonly string[]>> = {
	in: SEARCH_LOCATIONS,
	is: SEARCH_IS,
	has: SEARCH_HAS,
	via: CAPTURE_SOURCES,
	sort: SEARCH_SORTS,
}

const KEY_HINT = (key: SearchKey) =>
	key === "after" ? "search.suggest.after" : `search.tipRows.${key}`

/** Date values worth offering, with what they mean. `today` is a local `YYYY-MM-DD`. */
function dateValues(key: SearchKey, today: string): SuggestionItem[] {
	const year = { insert: today.slice(0, 4), hint: "search.suggest.thisYear" }
	const month = { insert: today.slice(0, 7), hint: "search.suggest.thisMonth" }
	if (key === "before" || key === "after")
		return [{ insert: today, hint: "search.suggest.today" }, month, year]
	return [
		{ insert: "7d", hint: "search.suggest.last7d" },
		{ insert: "1m", hint: "search.suggest.lastMonth" },
		{ insert: "1y", hint: "search.suggest.lastYear" },
		month,
		year,
	]
}

/**
 * Completions for the token that ends at the caret; null when there is nothing to offer. One
 * letter offers nothing (most words start like some key), and neither does a finished value.
 */
export function suggest(q: string, caret: number, today: string): Suggestions | null {
	const token = parseSearchQuery(q).tokens.find((t) => t.end === caret)
	if (!token) return null
	const dash = token.raw.startsWith("-") ? "-" : ""
	const m = /^([a-z]+)(?::(.*))?$/i.exec(token.raw.slice(dash.length))
	if (!m) return null
	const range = { start: token.start, end: token.end }
	const word = m[1]!.toLowerCase()
	if (m[2] === undefined) {
		if (word.length < 2) return null
		const items = SEARCH_KEYS.filter(
			(key) => key.startsWith(word) && !(dash && NOT_NEGATED.has(key)),
		).map((key) => ({ insert: `${dash}${key}:`, hint: KEY_HINT(key) }))
		return items.length > 0 ? { ...range, items } : null
	}
	const key = SEARCH_KEYS.find((k) => k === word)
	if (!key || key === "title" || (dash && NOT_NEGATED.has(key))) return null
	// An open quote is a value still being typed; a closed one is finished.
	const quoted = m[2].startsWith('"')
	const typed = quoted ? m[2].slice(1) : m[2]
	if (typed.includes('"')) return null
	if (key === "site" || key === "author" || key === "tag")
		return { ...range, items: [], remote: { key, prefix: typed, negated: dash !== "" } }
	if (quoted) return null
	const values =
		FIXED_VALUES[key]?.map((value): SuggestionItem => ({ insert: value })) ?? dateValues(key, today)
	const prefix = typed.toLowerCase()
	const items = values
		.filter((v) => v.insert.startsWith(prefix) && v.insert !== prefix)
		.map((v) => ({ ...v, insert: `${dash}${key}:${v.insert} ` }))
	return items.length > 0 ? { ...range, items } : null
}

/** The library's values for `site:`, `author:` or `tag:`, as items. A value with a space is quoted. */
export function valueItems(remote: RemoteValues, values: string[]): SuggestionItem[] {
	return values.map((value) => {
		const clean = value.replaceAll('"', "").trim()
		const written = /\s/.test(clean) ? `"${clean}"` : clean
		return { insert: `${remote.negated ? "-" : ""}${remote.key}:${written} ` }
	})
}
