export type Page<T> = { items: T[]; nextCursor: string | null }

/**
 * A list loaded a page at a time (`usePagedList`).
 * - `items`: null until the first load answers.
 * - `more`, the next page: `loading` it (for the list as it was at `ticket`), or `failed`, not
 *   asked again by scrolling (it would ask as fast as the list redraws), but by Try Again at the
 *   end of the list, or the next load.
 * - `ticket`: bumped by whatever makes the answers on their way stale (a load, an edit, another
 *   query). An answer carries the ticket it was asked at; an older one is dropped.
 */
export type PagedList<T> = {
	items: T[] | null
	next: string | null
	error: string | null
	refreshing: boolean
	more: { status: "idle" } | { status: "loading"; ticket: number } | { status: "failed" }
	ticket: number
}

export function pagedListStart<T>(ticket = 0): PagedList<T> {
	return { items: null, next: null, error: null, refreshing: false, more: IDLE, ticket }
}

const IDLE = { status: "idle" } as const

export type PagedListEvent<T> =
	/** Something else is asked for (a filter, a search): the list starts over, empty. */
	| { type: "asked" }
	/** A load starts: it answers for `ticket` after this. */
	| { type: "load" }
	| { type: "loaded"; ticket: number; page: Page<T> }
	/** `kept`: what was kept for offline reading, shown when nothing is yet. */
	| { type: "loadFailed"; ticket: number; message: string; kept?: T[] | null }
	/** The next page starts: refused without one, or while one loads or after one failed. */
	| { type: "more" }
	| { type: "moreLoaded"; ticket: number; page: Page<T> }
	| { type: "moreFailed"; ticket: number; message: string }
	/** Try Again, under a next page that failed. */
	| { type: "retryMore" }
	/** What is shown changes at once, as an action does. */
	| { type: "edited"; change: (shown: T[]) => T[] }
	| { type: "refreshing"; on: boolean }

/** The next state. Pure; an event that changes nothing returns the same state. */
export function pagedListTransition<T extends { id: string }>(
	state: PagedList<T>,
	event: PagedListEvent<T>,
): PagedList<T> {
	switch (event.type) {
		case "asked":
			return pagedListStart(state.ticket + 1)
		case "load":
			return { ...state, ticket: state.ticket + 1 }
		case "loaded":
			if (event.ticket !== state.ticket) return state
			return {
				...state,
				items: event.page.items,
				next: event.page.nextCursor,
				error: null,
				// A next page that failed can be asked for again.
				more: state.more.status === "failed" ? IDLE : state.more,
			}
		case "loadFailed":
			if (event.ticket !== state.ticket) return state
			return { ...state, items: state.items ?? event.kept ?? null, error: event.message }
		case "more":
			if (!state.items || !state.next || state.more.status !== "idle") return state
			return { ...state, more: { status: "loading", ticket: state.ticket } }
		case "retryMore":
			if (state.more.status !== "failed") return state
			return { ...state, more: { status: "loading", ticket: state.ticket } }
		case "moreLoaded": {
			if (state.more.status !== "loading" || state.more.ticket !== event.ticket) return state
			if (event.ticket !== state.ticket) return { ...state, more: IDLE }
			const seen = new Set(state.items?.map((item) => item.id))
			return {
				...state,
				items: [...(state.items ?? []), ...event.page.items.filter((item) => !seen.has(item.id))],
				next: event.page.nextCursor,
				error: null,
				more: IDLE,
			}
		}
		case "moreFailed":
			if (state.more.status !== "loading" || state.more.ticket !== event.ticket) return state
			// Asked for a list that has changed since: the load after it says how it is.
			if (event.ticket !== state.ticket) return { ...state, more: IDLE }
			return { ...state, error: event.message, more: { status: "failed" } }
		case "edited":
			return {
				...state,
				items: state.items && event.change(state.items),
				ticket: state.ticket + 1,
			}
		case "refreshing":
			return state.refreshing === event.on ? state : { ...state, refreshing: event.on }
	}
}
