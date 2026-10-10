import type { ArticleSummary } from "@klipstack/sdk"
import { retagged } from "./article-tags"

export type HomeSections = {
	/** The big card: the article read last, or else the newest save. */
	hero: ArticleSummary | null
	/** More articles in progress. */
	reading: ArticleSummary[]
	recent: ArticleSummary[]
	quick: ArticleSummary[]
}

/**
 * The home page from three library lists, as the web builds it (reading-home.server.ts): articles
 * in progress (most recently read first), unread saves (newest first) and short ones. Only ready
 * articles, and each article once, in that order of sections. With nothing in progress, the
 * newest save takes the big card.
 */
export function homeSections(
	lists: { reading: ArticleSummary[]; unread: ArticleSummary[]; quick: ArticleSummary[] },
	{ perShelf = 8 } = {},
): HomeSections {
	const shown = new Set<string>()
	const take = (items: ArticleSummary[], max: number) => {
		const out: ArticleSummary[] = []
		for (const item of items) {
			if (out.length === max) break
			if (item.status !== "ready" || shown.has(item.id)) continue
			shown.add(item.id)
			out.push(item)
		}
		return out
	}
	const reading = take(lists.reading, perShelf + 1)
	const recent = take(lists.unread, reading.length ? perShelf : perShelf + 1)
	const hero = reading[0] ?? recent[0] ?? null
	return {
		hero,
		reading: reading.slice(1),
		recent: reading.length ? recent : recent.slice(1),
		quick: take(lists.quick, perShelf),
	}
}

/**
 * The sections with some articles changed (the long-press menu's actions): those no longer in the
 * library (archived, finished or deleted) leave. Home loads again after, to sort the rest.
 */
export function withChanges(
	home: HomeSections,
	changed: Map<string, ArticleSummary>,
): HomeSections {
	const kept = (item: ArticleSummary) => {
		const now = changed.get(item.id) ?? item
		return now.location === "inbox" && !now.trashedAt ? now : null
	}
	const shelf = (items: ArticleSummary[]) =>
		items.map(kept).filter((a): a is ArticleSummary => a !== null)
	return {
		hero: home.hero && kept(home.hero),
		reading: shelf(home.reading),
		recent: shelf(home.recent),
		quick: shelf(home.quick),
	}
}

/** The sections with the tags the tag sheet reports: Home shows none, but the sheet reads them. */
export function withTags(home: HomeSections, tags: Map<string, string[]>): HomeSections {
	const shelf = (items: ArticleSummary[]) => items.map((a) => retagged(a, tags))
	return {
		hero: home.hero && retagged(home.hero, tags),
		reading: shelf(home.reading),
		recent: shelf(home.recent),
		quick: shelf(home.quick),
	}
}

/** Minutes left at this progress, rounded up; null without a reading time. */
export function minutesLeft(article: Pick<ArticleSummary, "readingMinutes" | "progress">) {
	if (!article.readingMinutes) return null
	return Math.max(1, Math.ceil(article.readingMinutes * (1 - article.progress)))
}
