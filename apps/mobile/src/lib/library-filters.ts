import {
	ARCHIVE_FILTERS,
	INBOX_FILTERS,
	LIST_SORTS,
	type ListFilter,
	type ListSort,
} from "@klipstack/api-contract/enums"
import type { ArticleSummary } from "@klipstack/sdk"
import { t } from "./i18n"

/**
 * The library's filters and sort orders, as the web's (`apps/web/app/lib/inbox-filters.ts`): Inbox
 * has its filters and the sort menu, Archive and Starred the archive's filters and one order, by
 * when articles got there. Pure: the screen is `components/library-list.tsx`.
 */

export type { ListFilter, ListSort }

/** A list with filters: the API's `inbox`, `archive` and `starred` views. */
export type FilterableView = "inbox" | "archive" | "starred"

/** `GET /articles/counts`: how many articles each of the view's filters shows. */
export type FilterCounts = Partial<Record<ListFilter, number>>

/** The filter a list shows, or null for all of it. */
export type FilterChoice = ListFilter | null

const FILTER_LABELS: Record<ListFilter, string> = {
	unread: t("library.filters.unread"),
	progress: t("library.filters.progress"),
	again: t("library.filters.again"),
	read: t("library.filters.read"),
	quick: t("library.filters.quick"),
	long: t("library.filters.long"),
	x: t("library.filters.x"),
	unfinished: t("library.filters.unfinished"),
	finished: t("library.filters.finished"),
}

const SORT_LABELS: Record<ListSort, string> = {
	recent: t("library.sorts.recent"),
	newest: t("library.sorts.newest"),
	oldest: t("library.sorts.oldest"),
	shortest: t("library.sorts.shortest"),
	longest: t("library.sorts.longest"),
}

export const filterLabel = (filter: FilterChoice) =>
	filter ? FILTER_LABELS[filter] : t("library.filters.all")
export const sortLabel = (sort: ListSort) => SORT_LABELS[sort]

export function filtersFor(view: FilterableView): readonly ListFilter[] {
	return view === "inbox" ? INBOX_FILTERS : ARCHIVE_FILTERS
}

/** Only Inbox has a sort menu. */
export function sortsFor(view: FilterableView): readonly ListSort[] {
	return view === "inbox" ? LIST_SORTS : []
}

/** As on the web: what is in progress, most recently read first; everything else newest first. */
export function defaultSort(filter: FilterChoice): ListSort {
	return filter === "progress" ? "recent" : "newest"
}

/**
 * The menu's Show section: All, then each filter with articles in it, with how many, as the web's
 * chips. The chosen one shows even when it holds none, so the reader can see what is on. Without
 * counts (offline, or still loading) every filter shows, uncounted.
 */
export function filterMenu(
	view: FilterableView,
	counts: FilterCounts | null,
	chosen: FilterChoice,
): { value: FilterChoice; label: string; count: number | null; on: boolean }[] {
	const shown = filtersFor(view).filter((f) => !counts || (counts[f] ?? 0) > 0 || f === chosen)
	return [
		{ value: null, label: t("library.filters.all"), count: null, on: chosen === null },
		...shown.map((f) => ({
			value: f,
			label: FILTER_LABELS[f],
			count: counts ? (counts[f] ?? 0) : null,
			on: f === chosen,
		})),
	]
}

/** Quick reads take at most this many minutes, long reads at least this many (as the server). */
const QUICK_MAX_MINUTES = 10
const LONG_MIN_MINUTES = 30

const fromX = (a: ArticleSummary) => a.url.startsWith("https://x.com/")
const neverOpened = (a: ArticleSummary) => !a.opened && a.status !== "failed"

/**
 * Whether an article belongs in a filter, as the server decides it (`INBOX_FILTER_WHERE` and
 * `ARCHIVE_FILTER_WHERE`), from what an article summary says. Null when it can't say: Read again
 * needs the history of finishes, and Quick reads leave out what isn't an article (a post, a video),
 * which the summary doesn't tell.
 */
export function inFilter(
	view: FilterableView,
	filter: ListFilter,
	a: ArticleSummary,
): boolean | null {
	const minutes = a.readingMinutes
	const quick = minutes !== null && minutes <= QUICK_MAX_MINUTES ? null : false
	const long = minutes !== null && minutes >= LONG_MIN_MINUTES
	if (view === "inbox") {
		switch (filter) {
			case "unread":
				return neverOpened(a)
			case "again":
				return neverOpened(a) ? null : false
			case "progress":
				return a.opened && !a.finished
			case "read":
				return a.finished
			case "quick":
				return a.finished ? false : quick
			case "long":
				return long && !a.finished
			case "x":
				return fromX(a) && !a.finished
			default:
				return false
		}
	}
	switch (filter) {
		case "finished":
			return a.finished
		case "unfinished":
			return !a.finished
		case "quick":
			return quick
		case "long":
			return long
		case "x":
			return fromX(a)
		default:
			return false
	}
}

/**
 * Whether a filtered list still shows an article an action changed: not once the server would
 * leave it out (marked unread in Read, finished in Unread). When the summary can't say, it stays
 * until the list loads again.
 */
export function stillInFilter(
	view: FilterableView,
	filter: FilterChoice,
	after: ArticleSummary,
): boolean {
	return filter === null || inFilter(view, filter, after) !== false
}

/**
 * Whether a load is the list to keep for offline reading: all of it, in its own order. A filter's
 * or another order's page would replace the whole list the phone keeps.
 */
export function keepsWholeList(filter: FilterChoice, sort: ListSort): boolean {
	return filter === null && sort === defaultSort(null)
}

/**
 * A list kept for offline reading, as a filter and an order would show it: what the phone kept of
 * the whole list, narrowed and sorted as the server would. Null when the summaries can't say
 * which articles belong (Read again, Quick reads): the list then shows the offline note alone.
 * Newest first and Recently read keep the kept order, which is the list's own: by when articles
 * were starred, in Starred; the summaries don't say when each was last read.
 */
export function narrowKept(
	kept: ArticleSummary[],
	view: FilterableView,
	filter: FilterChoice,
	sort: ListSort,
): ArticleSummary[] | null {
	let items = kept
	if (filter) {
		const verdicts = kept.map((a) => inFilter(view, filter, a))
		if (verdicts.includes(null)) return null
		items = kept.filter((_, i) => verdicts[i])
	}
	return sorted(items, sort)
}

function sorted(items: ArticleSummary[], sort: ListSort): ArticleSummary[] {
	const saved = (a: ArticleSummary) => Date.parse(a.savedAt)
	// Unknown lengths last, as the server's `nulls last`.
	const minutes = (a: ArticleSummary, unknown: number) => a.readingMinutes ?? unknown
	switch (sort) {
		case "oldest":
			return items.toSorted((a, b) => saved(a) - saved(b))
		case "shortest":
			return items.toSorted((a, b) => minutes(a, Infinity) - minutes(b, Infinity))
		case "longest":
			return items.toSorted((a, b) => minutes(b, -Infinity) - minutes(a, -Infinity))
		case "newest":
		case "recent":
			return items
	}
}

/** What the toast says once "Archive all read" is done, as the web's. */
export function archivedReadNotice(count: number): string {
	if (count === 0) return t("library.filters.archivedNone")
	return t("library.filters.archivedRead", { count })
}

/** The line above a filtered list: what it shows, and how many. */
export function filterLine(filter: ListFilter, count: number | undefined): string {
	if (count === undefined) return FILTER_LABELS[filter]
	return `${FILTER_LABELS[filter]} · ${t("library.articles", { count })}`
}
