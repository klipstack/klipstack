/** Highlights page filters and views, from the URL (`?show=…&view=…`); safe to import from client code. */
import { HIGHLIGHT_FILTERS, type HighlightFilter } from "@klipstack/api-contract/enums"

export { HIGHLIGHT_FILTERS, type HighlightFilter }

export const HIGHLIGHT_VIEWS = ["stream", "articles"] as const
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

/** Query string for the page; an empty query and no filter are left out. */
export function highlightsSearch({
	filter,
	view,
	q,
}: {
	filter: HighlightFilter | null
	view: HighlightView
	q: string
}): string {
	const params = new URLSearchParams()
	if (q) params.set("q", q)
	if (filter) params.set("show", filter)
	// Always explicit: the default depends on the cookie, and an explicit view is what saves it.
	params.set("view", view)
	const s = params.toString()
	return s ? `?${s}` : ""
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
