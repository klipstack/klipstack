/** Highlights page filters and views, from the URL (`?show=…&view=…`); safe to import from client code. */
import { HIGHLIGHT_FILTERS, type HighlightFilter } from "@klipstack/api-contract/enums"

export { HIGHLIGHT_FILTERS, type HighlightFilter }

/** Newest first, by article, and by the articles' topics (only while the reader's topics are in use). */
export const HIGHLIGHT_VIEWS = ["stream", "articles", "topics"] as const
export type HighlightView = (typeof HIGHLIGHT_VIEWS)[number]

export function parseHighlightFilter(value: string | null): HighlightFilter | null {
	return (HIGHLIGHT_FILTERS as readonly string[]).includes(value ?? "")
		? (value as HighlightFilter)
		: null
}

/**
 * The view last picked is kept on the device in a cookie (like list/grid), so the server renders
 * it right away. Without one: by article.
 */
export const HIGHLIGHT_VIEW_COOKIE = "klip_hl_view"
export const DEFAULT_HIGHLIGHT_VIEW: HighlightView = "articles"

export function parseHighlightView(value: string | null | undefined): HighlightView | null {
	return (HIGHLIGHT_VIEWS as readonly string[]).includes(value ?? "")
		? (value as HighlightView)
		: null
}

export function highlightViewFromCookie(
	cookieHeader: string | null | undefined,
): HighlightView | null {
	const match = new RegExp(`(?:^|;\\s*)${HIGHLIGHT_VIEW_COOKIE}=([a-z]+)(?:;|$)`).exec(
		cookieHeader ?? "",
	)
	return parseHighlightView(match?.[1])
}

/** What the highlights page shows, from its address. */
export interface HighlightsState {
	q: string
	filter: HighlightFilter | null
	view: HighlightView
	/** One of the user's tags, by id: only highlights in articles with it. */
	tag: string | null
	/** One of the user's topics, by id, or `none`: the highlights a topic group holds. */
	topic: string | null
}

/**
 * The page's address for a state, changed by `change`. An empty query and no filter are left out.
 * The topics view is every topic: a topic chosen goes. `shuffle` deals a hand (`new`: a new one);
 * `cursor` is a page of the stream.
 */
export function highlightsHref(
	state: HighlightsState,
	change: Partial<HighlightsState> & { shuffle?: string; cursor?: string } = {},
): string {
	const next = { ...state, ...change }
	const params = new URLSearchParams()
	if (next.q) params.set("q", next.q)
	if (next.filter) params.set("show", next.filter)
	if (next.tag) params.set("tag", next.tag)
	if (next.topic && next.view !== "topics") params.set("topic", next.topic)
	// Always explicit: the default depends on the cookie, and an explicit view is what saves it.
	if (!change.shuffle) params.set("view", next.view)
	if (change.shuffle) params.set("shuffle", change.shuffle)
	if (change.cursor) params.set("cursor", change.cursor)
	return `/highlights?${params}`
}

/** The parameters a search keeps from the page, as the search form's hidden fields. */
export function highlightsKeep(state: HighlightsState): Record<string, string> {
	const keep: Record<string, string> = { view: state.view }
	if (state.filter) keep.show = state.filter
	if (state.tag) keep.tag = state.tag
	if (state.topic && state.view !== "topics") keep.topic = state.topic
	return keep
}

export interface SearchTerm {
	text: string
	/** Quoted: matched as written (bar case and accents), no word variants. */
	phrase: boolean
}

/**
 * Search terms: "quoted text" is one phrase (straight or curly quotes), everything else a word.
 * An unclosed quote counts as plain words. At most 8 terms. NUL characters are dropped (Postgres
 * text cannot hold them).
 */
export function searchTerms(q: string): SearchTerm[] {
	const terms: SearchTerm[] = []
	for (const m of q
		.replaceAll("\u0000", "")
		.slice(0, 200)
		.matchAll(/["“”]([^"“”]*)["“”]|[^\s"“”]+/g)) {
		const text = (m[1] ?? m[0]).trim().replace(/\s+/g, " ")
		if (text) terms.push({ text, phrase: m[1] !== undefined })
	}
	return terms.slice(0, 8)
}
