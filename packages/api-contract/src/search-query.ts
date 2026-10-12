/**
 * The search query language: words plus operators (`in:archive`, `is:starred`, `saved:7d`).
 * This entry point imports only `./enums` and `./names`, so client code can use it. Turning a parsed query into
 * SQL is the server's job.
 */
import {
	CAPTURE_SOURCES,
	type CaptureSource,
	SEARCH_HAS,
	SEARCH_IS,
	SEARCH_LOCATIONS,
	SEARCH_SORTS,
	type SearchHas,
	type SearchIs,
	type SearchLocation,
	type SearchSort,
} from "./enums"
import { cleanTagName, cleanTopicName, SAVED_SEARCH_NAME_MAX } from "./names"

/** Characters of a query that count; the rest is cut before parsing. */
export const QUERY_MAX = 200
/** Operators past this many are ignored. */
export const OPERATORS_MAX = 20
/** Pages stop here: relevance order has no cursor, and nobody reads this far. */
export const SEARCH_OFFSET_MAX = 1000
/** Most results one search returns. */
export const SEARCH_LIMIT_MAX = 50

export const SEARCH_KEYS = [
	"in",
	"is",
	"has",
	"site",
	"author",
	"title",
	"tag",
	"topic",
	"via",
	"saved",
	"published",
	"before",
	"after",
	"sort",
] as const
export type SearchKey = (typeof SEARCH_KEYS)[number]

export interface Token {
	/** As typed, quotes and dash included. */
	raw: string
	start: number
	end: number
	kind: "text" | "operator" | "ignored"
	/** Operators, and ignored tokens with a known key: the key, and the value without its quotes. */
	key?: SearchKey
	value?: string
}

export type DateUnit = "d" | "w" | "m" | "y"
/** A local date (`YYYY-MM-DD`), or that long before today. */
export type DatePoint = { date: string } | { ago: number; unit: DateUnit }
/** Local dates. `from` counts, `to` does not. */
export interface DateRange {
	from: DatePoint | null
	to: DatePoint | null
}

export type Filter =
	| { key: "in"; value: SearchLocation; negated: boolean }
	| { key: "is"; value: SearchIs; negated: boolean }
	| { key: "has"; value: SearchHas; negated: boolean }
	| { key: "site" | "author" | "title"; value: string; negated: boolean }
	/** A whole tag name, cleaned as names are. */
	| { key: "tag"; value: string; negated: boolean }
	/** A whole topic name, cleaned as names are. */
	| { key: "topic"; value: string; negated: boolean }
	| { key: "via"; value: CaptureSource; negated: boolean }
	| { key: "saved" | "published"; value: DateRange; negated: false }

export interface SearchQuery {
	/** The words, as typed, for the full-text search. Empty when the query is only operators. */
	text: string
	filters: Filter[]
	sort: SearchSort | null
	/** Raw tokens the parser did not understand, in order. */
	ignored: string[]
	tokens: Token[]
}

const pad = (n: number, width: number) => String(n).padStart(width, "0")

/** Date.UTC reads years 0–99 as 1900–1999: set the year on its own. */
function utc(year: number, month: number, day: number): Date {
	const d = new Date(0)
	d.setUTCFullYear(year, month - 1, day)
	return d
}

const isoDate = (d: Date) =>
	`${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`

/** A year, a month or a day: its first day, and the day after its last. */
function period(value: string): { start: string; end: string } | null {
	const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value)
	if (!m) return null
	const year = Number(m[1])
	const month = m[2] === undefined ? null : Number(m[2])
	const day = m[3] === undefined ? null : Number(m[3])
	if (year < 1 || (month !== null && (month < 1 || month > 12))) return null
	const start = utc(year, month ?? 1, day ?? 1)
	// 2026-02-30 rolls over into March: not a date.
	if (day !== null && start.getUTCDate() !== day) return null
	const end =
		day !== null
			? utc(year, month!, day + 1)
			: month !== null
				? utc(year, month + 1, 1)
				: utc(year + 1, 1, 1)
	return { start: isoDate(start), end: isoDate(end) }
}

function dateRange(value: string): DateRange | null {
	const relative = /^(\d{1,4})([dwmy])$/i.exec(value)
	if (relative) {
		const ago = Number(relative[1])
		if (ago < 1) return null
		return { from: { ago, unit: relative[2]!.toLowerCase() as DateUnit }, to: null }
	}
	const range = /^(.+)\.\.(.+)$/.exec(value)
	if (range) {
		const first = period(range[1]!)
		const last = period(range[2]!)
		if (!first || !last || first.start >= last.end) return null
		return { from: { date: first.start }, to: { date: last.end } }
	}
	const compared = /^(>=|<=|>|<)(.+)$/.exec(value)
	if (compared) {
		const p = period(compared[2]!)
		if (!p) return null
		switch (compared[1]) {
			case ">":
				return { from: { date: p.end }, to: null }
			case ">=":
				return { from: { date: p.start }, to: null }
			case "<":
				return { from: null, to: { date: p.start } }
			default:
				return { from: null, to: { date: p.end } }
		}
	}
	const p = period(value)
	return p ? { from: { date: p.start }, to: { date: p.end } } : null
}

const oneOf = <T extends string>(values: readonly T[], value: string): T | null =>
	(values as readonly string[]).includes(value.toLowerCase()) ? (value.toLowerCase() as T) : null

/** The filter an operator stands for; null when the key does not take that value. */
function toFilter(key: Exclude<SearchKey, "sort">, value: string, negated: boolean): Filter | null {
	switch (key) {
		case "in": {
			const v = oneOf(SEARCH_LOCATIONS, value)
			return v && { key, value: v, negated }
		}
		case "is": {
			const v = oneOf(SEARCH_IS, value)
			return v && { key, value: v, negated }
		}
		case "has": {
			const v = oneOf(SEARCH_HAS, value)
			return v && { key, value: v, negated }
		}
		case "via": {
			const v = oneOf(CAPTURE_SOURCES, value)
			return v && { key, value: v, negated }
		}
		case "site":
		case "author":
		case "title":
			return { key, value, negated }
		case "tag": {
			const name = cleanTagName(value)
			return name === null ? null : { key, value: name, negated }
		}
		case "topic": {
			const name = cleanTopicName(value)
			return name === null ? null : { key, value: name, negated }
		}
		case "saved":
		case "published": {
			const range = negated ? null : dateRange(value)
			return range && { key, value: range, negated: false }
		}
		case "before":
		case "after": {
			const p = negated ? null : period(value)
			if (!p) return null
			const point = { date: p.start }
			return {
				key: "saved",
				value: key === "before" ? { from: null, to: point } : { from: point, to: null },
				negated: false,
			}
		}
	}
}

/** Splits on whitespace; double quotes keep spaces inside one token. */
function tokenize(input: string): Array<Pick<Token, "raw" | "start" | "end">> {
	const tokens = []
	let i = 0
	while (i < input.length) {
		if (/\s/.test(input[i]!)) {
			i++
			continue
		}
		const start = i
		let quoted = false
		while (i < input.length && (quoted || !/\s/.test(input[i]!))) {
			if (input[i] === '"') quoted = !quoted
			i++
		}
		tokens.push({ raw: input.slice(start, i), start, end: i })
	}
	return tokens
}

export function parseSearchQuery(q: string): SearchQuery {
	const query: SearchQuery = { text: "", filters: [], sort: null, ignored: [], tokens: [] }
	const words: string[] = []
	let operators = 0
	for (const piece of tokenize(q.slice(0, QUERY_MAX))) {
		const negated = piece.raw.startsWith("-")
		// Only known keys are operators: a URL, "note: x" and "10:30" stay text, and so does
		// anything that starts with a quote.
		const m = /^([a-z]+):(.+)$/i.exec(negated ? piece.raw.slice(1) : piece.raw)
		const key = m ? oneOf(SEARCH_KEYS, m[1]!) : null
		const value = m ? m[2]!.replace(/^"/, "").replace(/"$/, "").trim() : ""
		if (!key || !value) {
			query.tokens.push({ ...piece, kind: "text" })
			words.push(piece.raw)
			continue
		}
		const sort = key === "sort" && !negated ? oneOf(SEARCH_SORTS, value) : null
		const filter = key === "sort" ? null : toFilter(key, value, negated)
		if ((!sort && !filter) || ++operators > OPERATORS_MAX) {
			query.tokens.push({ ...piece, kind: "ignored", key, value })
			query.ignored.push(piece.raw)
			continue
		}
		query.tokens.push({ ...piece, kind: "operator", key, value })
		if (sort) query.sort = sort
		if (filter) query.filters.push(filter)
	}
	query.text = words.join(" ")
	return query
}

const joined = (tokens: Token[]) => tokens.map((t) => t.raw).join(" ")

/**
 * The same query without the operators of that key (and that value, when given), negated ones
 * included. The rest stays as typed.
 */
export function removeOperator(q: string, key: SearchKey, value?: string): string {
	const wanted = value?.toLowerCase()
	return joined(
		parseSearchQuery(q).tokens.filter(
			(t) => t.key !== key || (wanted !== undefined && t.value?.toLowerCase() !== wanted),
		),
	)
}

/** `key:value` as the chips write it: a value with a space in it is quoted. */
function operatorText(key: SearchKey, value: string): string {
	const clean = value.replaceAll('"', "").trim()
	return `${key}:${/\s/.test(clean) ? `"${clean}"` : clean}`
}

/** Appends `key:value`, quoting a value with a space in it. */
export function addOperator(q: string, key: SearchKey, value: string): string {
	return `${q.trimEnd()} ${operatorText(key, value)}`.trimStart()
}

/**
 * The same query with every `tag:` and `-tag:` of one tag pointing at another: a tag was renamed,
 * or merged into the other. Names match whatever their case. A token the change made a repeat of
 * another one goes; the rest stays as typed. A result past `QUERY_MAX` leaves the query as it was.
 */
export function renameTagOperator(q: string, from: string, to: string): string {
	if (q.length > QUERY_MAX) return q
	const old = from.toLowerCase()
	const target = to.toLowerCase()
	const tagOf = (t: Token) =>
		t.key === "tag" && t.value ? cleanTagName(t.value)?.toLowerCase() : undefined
	const tokens = parseSearchQuery(q).tokens
	if (!tokens.some((t) => tagOf(t) === old)) return q
	// Of the tag that stays: one `tag:` and one `-tag:` at most.
	const kept = new Set<string>()
	let out = ""
	let end = 0
	for (const token of tokens) {
		const tag = tagOf(token)
		const dash = token.raw.startsWith("-") ? "-" : ""
		if (tag === old || tag === target) {
			if (kept.has(dash)) {
				// A repeat goes with the space before it.
				end = token.end
				continue
			}
			kept.add(dash)
		}
		out += q.slice(end, token.start)
		out += tag === old ? `${dash}${operatorText("tag", to)}` : token.raw
		end = token.end
	}
	out += q.slice(end)
	return out.length > QUERY_MAX ? q : out
}

/**
 * A topic's name as `topic:` can hold it, to compare: cleaned, lowercased, without the quotes a
 * name may have. Undefined when it cannot be a name.
 */
export const topicKey = (name: string) => cleanTopicName(name.replaceAll('"', ""))?.toLowerCase()

/**
 * The same query with every `topic:` and `-topic:` of one topic pointing at the topics that took
 * its place: renamed, merged into another, or split into several (one token each, which widen);
 * with none, the topic's tokens go.
 * Names match whatever their case and quotes. A token the change made a repeat of another one
 * goes; the rest stays as typed. A result past `QUERY_MAX` leaves the query as it was.
 */
export function renameTopicOperator(q: string, from: string, to: string[]): string {
	if (q.length > QUERY_MAX) return q
	const old = topicKey(from)
	const targets = new Set(to.map((name) => topicKey(name)))
	const topicOf = (t: Token) => (t.key === "topic" && t.value ? topicKey(t.value) : undefined)
	const tokens = parseSearchQuery(q).tokens
	if (!old || !tokens.some((t) => topicOf(t) === old)) return q
	// Of the topics that stay: one `topic:` and one `-topic:` of each at most.
	const kept = new Set<string>()
	let out = ""
	let end = 0
	for (const token of tokens) {
		const topic = topicOf(token)
		const dash = token.raw.startsWith("-") ? "-" : ""
		let text = token.raw
		if (topic === old) {
			const fresh = to.filter((name) => !kept.has(`${dash}${topicKey(name)}`))
			for (const name of fresh) kept.add(`${dash}${topicKey(name)}`)
			text = fresh.map((name) => `${dash}${operatorText("topic", name)}`).join(" ")
		} else if (topic !== undefined && targets.has(topic)) {
			if (kept.has(`${dash}${topic}`)) text = ""
			kept.add(`${dash}${topic}`)
		}
		if (!text) {
			// A repeat goes with the space before it.
			end = token.end
			continue
		}
		out += q.slice(end, token.start) + text
		end = token.end
	}
	out = (out + q.slice(end)).trim()
	return out.length > QUERY_MAX ? q : out
}

/** The topics a query names in `topic:` or `-topic:`, as written, once each whatever the case. */
export function topicsNamedIn(q: string): string[] {
	const names = new Map<string, string>()
	for (const token of parseSearchQuery(q).tokens)
		if (token.kind === "operator" && token.key === "topic" && token.value) {
			const key = topicKey(token.value) ?? token.value
			if (!names.has(key)) names.set(key, token.value)
		}
	return [...names.values()]
}

/** A query with no words and no filter, a sort at most: it finds the whole library. */
export function findsEverything(q: string): boolean {
	const { text, filters } = parseSearchQuery(q)
	return text.trim() === "" && filters.length === 0
}

/** Only the words, as typed. */
export function textOnly(q: string): string {
	return joined(parseSearchQuery(q).tokens.filter((t) => t.kind === "text"))
}

/** A query worth a name: it has a word or an operator the search understands, and it fits. */
export function canSaveSearch(q: string): boolean {
	const query = q.trim()
	if (query.length > QUERY_MAX) return false
	return parseSearchQuery(query).tokens.some((t) => t.kind !== "ignored")
}

/**
 * The name saving a search starts from (the web's dialog, the app's prompt): the query, or the tag
 * or topic when the query is one `tag:` or `topic:`.
 */
export function defaultSavedSearchName(q: string): string {
	const { tokens } = parseSearchQuery(q)
	const only = tokens.length === 1 ? tokens[0] : undefined
	const named =
		only?.kind === "operator" &&
		(only.key === "tag" || only.key === "topic") &&
		!only.raw.startsWith("-")
	const name = named ? (only?.value ?? "") : q
	return name.replace(/\s+/g, " ").trim().slice(0, SAVED_SEARCH_NAME_MAX).trim()
}
