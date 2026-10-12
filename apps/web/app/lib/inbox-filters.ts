/** List filters and sort orders, from the URL (`?show=…&sort=…`); safe to import from client code. */
import {
	ARCHIVE_FILTERS,
	type ArchiveFilter,
	INBOX_FILTERS,
	type InboxFilter,
	LIST_SORTS,
	type ListFilter,
	type ListSort,
} from "@klipstack/api-contract/enums"

export {
	ARCHIVE_FILTERS,
	type ArchiveFilter,
	INBOX_FILTERS,
	type InboxFilter,
	LIST_SORTS,
	type ListFilter,
	type ListSort,
}

export type FilterableView = "inbox" | "archive" | "starred"

export function filtersFor(view: FilterableView): readonly ListFilter[] {
	return view === "inbox" ? INBOX_FILTERS : ARCHIVE_FILTERS
}

/** Quick reads take at most this many minutes. */
export const QUICK_MAX_MINUTES = 10

/** Home's "How much time do you have?" choices, in minutes. */
export const TIME_CHOICES = [5, 15, 30, 60] as const

/** Unread saves from before this many days come back on Home, a few at a time. */
export const REDISCOVER_AFTER_DAYS = 14

/** Home's time choice from the URL (`?time=15`): minutes, or null for any length. */
export function parseTime(value: string | null): number | null {
	const minutes = Number(value)
	return (TIME_CHOICES as readonly number[]).includes(minutes) ? minutes : null
}

/** Long reads take at least this many minutes. */
export const LONG_MIN_MINUTES = 30
/** Scrolled this far (0..1), an article counts as read even if never marked finished. */
export const READ_PROGRESS = 0.95

export function parseFilter(value: string | null, view: FilterableView): ListFilter | null {
	return (filtersFor(view) as readonly string[]).includes(value ?? "")
		? (value as ListFilter)
		: null
}

export function defaultSort(filter: ListFilter | null): ListSort {
	return filter === "progress" ? "recent" : "newest"
}

export function parseSort(value: string | null, filter: ListFilter | null = null): ListSort {
	return (LIST_SORTS as readonly string[]).includes(value ?? "")
		? (value as ListSort)
		: defaultSort(filter)
}

/**
 * Query string for a topic (an id, or `none`), a filter and a sort; defaults are left out. The
 * topic is checked by the server: one that is not the reader's shows every topic.
 */
export function listSearch(
	filter: ListFilter | null,
	sort: ListSort,
	topic: string | null = null,
): string {
	const params = new URLSearchParams()
	if (topic) params.set("topic", topic)
	if (filter) params.set("show", filter)
	if (sort !== defaultSort(filter)) params.set("sort", sort)
	const s = params.toString()
	return s ? `?${s}` : ""
}

/** Follow the new filter's default, but keep an explicit alternative order, and the topic. */
export function filterSearch(
	from: ListFilter | null,
	to: ListFilter | null,
	sort: ListSort,
	topic: string | null = null,
) {
	return listSearch(to, sort === defaultSort(from) ? defaultSort(to) : sort, topic)
}
