import type { ArticleSummary } from "@klipstack/sdk"
import { retagged } from "./article-tags"

/** The library lists Home is built from, in the order of its sections. */
export type HomeLists = {
	/** In progress, read last first. */
	reading: ArticleSummary[]
	/** Unread, newest first. */
	unread: ArticleSummary[]
	/** Ten minutes or less. */
	quick: ArticleSummary[]
	/**
	 * Thirty minutes or more, unfinished: for a time choice with room for them, as the newest unread
	 * are few. Those started belong to Continue reading, not to Recently saved.
	 */
	long: ArticleSummary[]
}

export type HomeSections = {
	/** The big card: the article read last, or else the newest save. */
	hero: ArticleSummary | null
	/** More articles in progress. */
	reading: ArticleSummary[]
	recent: ArticleSummary[]
	quick: ArticleSummary[]
	/** With a time chosen, the big card is the article read last though it doesn't fit. */
	pickUp: boolean
	/** With a time chosen, nothing fits (the article read last, kept anyway, doesn't count). */
	nothingFits: boolean
}

/** Minutes to choose from on Home: TIME_CHOICES in apps/web/app/lib/inbox-filters.ts. */
export const TIME_CHOICES = [5, 15, 30, 60] as const

/**
 * Home offers the time choice with more unfinished articles than this: TIME_FILTER_MIN in
 * apps/web/app/lib/home-shelves.ts, more than the web's Home shows at once.
 */
export const TIME_CHOICE_MIN = 9

/**
 * Whether Home offers "How much time do you have?": the web counts the library's unfinished
 * articles with a reading time; the phone counts those in the lists it loaded, each once.
 */
export function offersTimeChoice(lists: HomeLists): boolean {
	const unfinished = new Set<string>()
	for (const item of [...lists.reading, ...lists.unread, ...lists.quick, ...lists.long]) {
		if (item.status === "ready" && !item.finished && minutesLeft(item) !== null)
			unfinished.add(item.id)
	}
	return unfinished.size > TIME_CHOICE_MIN
}

/**
 * The home page from the library lists, as the web builds it (reading-home.server.ts): articles
 * in progress (most recently read first), unread saves (newest first) and short ones. Only ready
 * articles, and each article once, in that order of sections. With nothing in progress, the
 * newest save takes the big card.
 *
 * With a time chosen (`minutes`), as the web's `homeShelves` (apps/web/app/lib/home-shelves.ts),
 * each section keeps what can be finished in it, by time left. Continue reading still shows the
 * article read last when nothing in progress fits: finishing comes before starting more. The
 * unread sections show first what takes at least half the time, so more time brings longer
 * articles; Recently saved draws on the long reads not yet opened too.
 */
export function homeSections(
	lists: HomeLists,
	{ perShelf = 8, minutes = null }: { perShelf?: number; minutes?: number | null } = {},
): HomeSections {
	const fits = (item: ArticleSummary) => {
		if (minutes === null) return true
		const left = minutesLeft(item)
		return left !== null && left <= minutes
	}
	const fillsTime = (item: ArticleSummary) =>
		minutes !== null && fits(item) && minutesLeft(item)! * 2 >= minutes
	const fillingFirst = (items: ArticleSummary[]) =>
		minutes === null
			? items
			: [...items.filter(fillsTime), ...items.filter((item) => !fillsTime(item))]
	const shown = new Set<string>()
	const take = (items: ArticleSummary[], max: number) => {
		const out: ArticleSummary[] = []
		for (const item of items) {
			if (out.length === max) break
			if (item.status !== "ready" || shown.has(item.id) || !fits(item)) continue
			shown.add(item.id)
			out.push(item)
		}
		return out
	}
	const reading = take(lists.reading, perShelf + 1)
	const readLast = lists.reading.find((item) => item.status === "ready")
	const pickUp = !reading.length && minutes !== null && !!readLast
	if (pickUp) {
		shown.add(readLast!.id)
		reading.push(readLast!)
	}
	const unread =
		minutes === null
			? lists.unread
			: [
					...new Map(
						[...lists.unread, ...lists.long.filter((item) => !item.opened)].map((item) => [
							item.id,
							item,
						]),
					).values(),
				].sort((a, b) => b.savedAt.localeCompare(a.savedAt))
	const recent = take(fillingFirst(unread), reading.length ? perShelf : perShelf + 1)
	const hero = reading[0] ?? recent[0] ?? null
	const quick = take(fillingFirst(lists.quick), perShelf)
	return {
		hero,
		reading: reading.slice(1),
		recent: reading.length ? recent : recent.slice(1),
		quick,
		pickUp,
		nothingFits:
			minutes !== null && !(reading.length - (pickUp ? 1 : 0) + recent.length + quick.length),
	}
}

/**
 * Every article Home can show, for any length and for each time: what to keep for offline reading,
 * so a time chosen offline opens what it shows.
 */
export function everyHomeArticle(lists: HomeLists): ArticleSummary[] {
	const all = new Map<string, ArticleSummary>()
	for (const minutes of [null, ...TIME_CHOICES]) {
		const { hero, reading, recent, quick } = homeSections(lists, { minutes })
		for (const item of [...(hero ? [hero] : []), ...reading, ...recent, ...quick])
			all.set(item.id, item)
	}
	return [...all.values()]
}

/**
 * The lists with some articles changed (the long-press menu's actions): those no longer in the
 * library (archived, finished or deleted) leave. Home loads again after, to sort the rest.
 */
export function withChanges(lists: HomeLists, changed: Map<string, ArticleSummary>): HomeLists {
	const kept = (item: ArticleSummary) => {
		const now = changed.get(item.id) ?? item
		return now.location === "inbox" && !now.trashedAt ? now : null
	}
	return eachList(lists, (items) => items.map(kept).filter((a): a is ArticleSummary => a !== null))
}

/** The lists with the tags the tag sheet reports: Home shows none, but the sheet reads them. */
export function withTags(lists: HomeLists, tags: Map<string, string[]>): HomeLists {
	return eachList(lists, (items) => items.map((a) => retagged(a, tags)))
}

function eachList(lists: HomeLists, change: (items: ArticleSummary[]) => ArticleSummary[]) {
	return {
		reading: change(lists.reading),
		unread: change(lists.unread),
		quick: change(lists.quick),
		long: change(lists.long),
	}
}

/** Minutes left at this progress, rounded up; null without a reading time. */
export function minutesLeft(article: Pick<ArticleSummary, "readingMinutes" | "progress">) {
	if (!article.readingMinutes) return null
	return Math.max(1, Math.ceil(article.readingMinutes * (1 - article.progress)))
}
