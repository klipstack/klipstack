/** The Notebook's filters and views, from the URL (`?show=…&view=…`); safe to import from client code. */
import { NOTEBOOK_FILTERS, type NotebookFilter } from "@klipstack/api-contract/enums"

/** The filters the API takes too (`GET /api/v1/notebook`). */
export { NOTEBOOK_FILTERS, type NotebookFilter }

/** Whether article notes show under a filter: under all, and under notes. */
export function showsArticleNotes(filter: NotebookFilter | null): boolean {
	return filter === null || filter === "notes"
}

/** By article, newest first, and by the articles' topics (only while the reader's topics are in use). */
export const NOTEBOOK_VIEWS = ["articles", "stream", "topics"] as const
export type NotebookView = (typeof NOTEBOOK_VIEWS)[number]

export function parseNotebookFilter(value: string | null): NotebookFilter | null {
	return (NOTEBOOK_FILTERS as readonly string[]).includes(value ?? "")
		? (value as NotebookFilter)
		: null
}

/**
 * The view last picked is kept on the device in a cookie (like list/grid), so the server renders
 * it right away. Without one: by article. Named for the highlights page it came from: the privacy
 * policy lists it so.
 */
export const NOTEBOOK_VIEW_COOKIE = "klip_hl_view"
export const DEFAULT_NOTEBOOK_VIEW: NotebookView = "articles"

export function parseNotebookView(value: string | null | undefined): NotebookView | null {
	return (NOTEBOOK_VIEWS as readonly string[]).includes(value ?? "")
		? (value as NotebookView)
		: null
}

export function notebookViewFromCookie(
	cookieHeader: string | null | undefined,
): NotebookView | null {
	const match = new RegExp(`(?:^|;\\s*)${NOTEBOOK_VIEW_COOKIE}=([a-z]+)(?:;|$)`).exec(
		cookieHeader ?? "",
	)
	return parseNotebookView(match?.[1])
}

/** What the Notebook shows, from its address. */
export interface NotebookState {
	q: string
	filter: NotebookFilter | null
	view: NotebookView
	/** One of the user's tags, by id: only what was kept from articles with it. */
	tag: string | null
	/** One of the user's topics, by id, or `none`: what a topic group holds. */
	topic: string | null
}

/**
 * The page's address for a state, changed by `change`. An empty query and no filter are left out.
 * The topics view is every topic: a topic chosen goes. `shuffle` deals a hand (`new`: a new one);
 * `cursor` is a page of the stream or of the articles.
 */
export function notebookHref(
	state: NotebookState,
	change: Partial<NotebookState> & { shuffle?: string; cursor?: string } = {},
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
	return `/notebook?${params}`
}

/** The parameters a search keeps from the page, as the search form's hidden fields. */
export function notebookKeep(state: NotebookState): Record<string, string> {
	const keep: Record<string, string> = { view: state.view }
	if (state.filter) keep.show = state.filter
	if (state.tag) keep.tag = state.tag
	if (state.topic && state.view !== "topics") keep.topic = state.topic
	return keep
}
