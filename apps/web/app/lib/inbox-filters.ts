/** List filters and sort orders, from the URL (`?show=…&sort=…`); safe to import from client code. */
import {
	ARCHIVE_FILTERS,
	type ArchiveFilter,
	DEFAULT_TIME,
	INBOX_FILTERS,
	type InboxFilter,
	LIST_SORTS,
	type ListFilter,
	type ListSort,
	REDISCOVER_AFTER_DAYS,
	TIME_CHOICES,
} from "@klipstack/api-contract/enums"

export {
	ARCHIVE_FILTERS,
	type ArchiveFilter,
	DEFAULT_TIME,
	INBOX_FILTERS,
	type InboxFilter,
	LIST_SORTS,
	type ListFilter,
	type ListSort,
	REDISCOVER_AFTER_DAYS,
	TIME_CHOICES,
}

export type FilterableView = "inbox" | "archive" | "starred"

export function filtersFor(view: FilterableView): readonly ListFilter[] {
	return view === "inbox" ? INBOX_FILTERS : ARCHIVE_FILTERS
}

/** Quick reads take at most this many minutes. */
export const QUICK_MAX_MINUTES = 10

/** A time choice from the URL (`?time=30`); anything else is the default. */
export function parseTime(value: string | null): number {
	const minutes = Number(value)
	return (TIME_CHOICES as readonly number[]).includes(minutes) ? minutes : DEFAULT_TIME
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

/** Query string for a filter and sort; defaults are left out. */
export function listSearch(filter: ListFilter | null, sort: ListSort): string {
	const params = new URLSearchParams()
	if (filter) params.set("show", filter)
	if (sort !== defaultSort(filter)) params.set("sort", sort)
	const s = params.toString()
	return s ? `?${s}` : ""
}

/** Follow the new filter's default, but keep an explicit alternative order. */
export function filterSearch(from: ListFilter | null, to: ListFilter | null, sort: ListSort) {
	return listSearch(to, sort === defaultSort(from) ? defaultSort(to) : sort)
}
