import { and, asc, desc, eq, inArray } from "drizzle-orm"
import { db } from "./client"
import { feedItems, subscriptions } from "./schema"

/** A feed entry ready to store (the shape `@klipstack/extract` parses feeds into). */
export interface StorableFeedEntry {
	guid: string
	url: string
	urlHash: string
	title: string | null
	author: string | null
	excerpt: string | null
	publishedAt: Date | null
}

/** New entries stored per fetch at most: guards against a feed that reissues every id at once. */
export const MAX_NEW_ITEMS_PER_FETCH = 50

/** How many of a feed's latest items a new subscriber sees; the purge job always keeps these. */
export const INITIAL_ITEMS = 5

/**
 * Where an item sorts: its publish date, unless missing or later than when it was first seen.
 * Undated entries keep the feed's order: `position` milliseconds before first seen.
 */
export function sortDate(publishedAt: Date | null, firstSeenAt: Date, position = 0): Date {
	if (publishedAt && publishedAt <= firstSeenAt) return publishedAt
	return new Date(firstSeenAt.getTime() - position)
}

/**
 * Stores the entries a feed does not have yet (by guid), newest first, and records that the ones
 * it has are still listed. Returns how many were new.
 */
export async function storeFeedEntries(
	feedId: string,
	entries: StorableFeedEntry[],
	now = new Date(),
): Promise<number> {
	const unique = [...new Map(entries.map((e) => [e.guid, e])).values()]
	if (unique.length === 0) return 0
	const known = new Set(
		(
			await db
				.update(feedItems)
				.set({ lastSeenAt: now })
				.where(
					and(
						eq(feedItems.feedId, feedId),
						inArray(
							feedItems.guid,
							unique.map((e) => e.guid),
						),
					),
				)
				.returning({ guid: feedItems.guid })
		).map((r) => r.guid),
	)
	const fresh = unique
		.map((entry, position) => ({ entry, sortAt: sortDate(entry.publishedAt, now, position) }))
		.filter(({ entry }) => !known.has(entry.guid))
		.sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime())
		.slice(0, MAX_NEW_ITEMS_PER_FETCH)
	if (fresh.length === 0) return 0
	const inserted = await db
		.insert(feedItems)
		.values(
			fresh.map(({ entry, sortAt }) => ({
				feedId,
				guid: entry.guid,
				url: entry.url,
				urlHash: entry.urlHash,
				title: entry.title,
				author: entry.author,
				excerpt: entry.excerpt,
				publishedAt: entry.publishedAt,
				firstSeenAt: now,
				sortAt,
				lastSeenAt: now,
			})),
		)
		.onConflictDoNothing()
		.returning({ id: feedItems.id })
	return inserted.length
}

/**
 * The `since` for a new subscription to a feed: the sort date of its INITIAL_ITEMS-th latest item
 * (or its oldest, when it has fewer), so only those show. Null for a feed with no items yet.
 */
export async function initialSince(feedId: string): Promise<Date | null> {
	const [nth] = await db
		.select({ sortAt: feedItems.sortAt })
		.from(feedItems)
		.where(eq(feedItems.feedId, feedId))
		.orderBy(desc(feedItems.sortAt))
		.offset(INITIAL_ITEMS - 1)
		.limit(1)
	if (nth) return nth.sortAt
	const [oldest] = await db
		.select({ sortAt: feedItems.sortAt })
		.from(feedItems)
		.where(eq(feedItems.feedId, feedId))
		.orderBy(asc(feedItems.sortAt))
		.limit(1)
	return oldest?.sortAt ?? null
}

/** User ids following a feed. */
export async function feedSubscribers(feedId: string): Promise<string[]> {
	const rows = await db
		.select({ userId: subscriptions.userId })
		.from(subscriptions)
		.where(eq(subscriptions.feedId, feedId))
	return rows.map((r) => r.userId)
}
