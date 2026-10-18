import {
	FEED_TITLE_MAX,
	Id,
	Ids,
	NUL_REFUSED,
	Time,
	URL_MAX,
	withoutNul,
} from "@klipstack/api-contract"
import { z } from "zod"
import { AppError, notFound, parseInput, rateLimited } from "~/lib/app-error"
import { feedsOn } from "~/lib/features.server"
import { OPML_IMPORT_LIMIT, rateLimit, SAVE_LIMIT } from "~/lib/rate-limit.server"
import {
	dismissFeedItem as dismissOne,
	importOpml,
	markFeedItemViewed,
	markFeedViewed as markViewed,
	renameSubscription,
	restoreFeedItem as restoreOne,
	subscribe,
	unsubscribe,
} from "~/services/feeds.server"

/**
 * Following feeds and going through their posts, for the web, the API and MCP alike. Saving a post
 * is `saveFeedItems` (`commands/saving.server.ts`).
 */

const NO_FEED = "No followed feed with that id."
const NO_POST = "No post with that id in the feed."

const one = (id: string) => parseInput(Id, id)

/** Every command here, and saving a post: feeds are turned on for the account (Settings → Features). */
export async function mayUseFeeds(userId: string) {
	if (!(await feedsOn(userId)))
		throw new AppError("forbidden", "Feeds are turned off for this account.")
}

/**
 * Follows the feed behind what the user pasted: a feed, or a site that links one. A site with
 * several feeds is refused (`choose_feed`) with them, to follow one. Follows count against their
 * own limit (the save limit's size); a refused one does not.
 */
export async function followFeed(userId: string, url: string) {
	await mayUseFeeds(userId)
	const address = parseInput(z.string().trim().min(1).max(URL_MAX), url)
	const limited = rateLimit(`subscribe:${userId}`, SAVE_LIMIT.limit, SAVE_LIMIT.windowMs)
	if (!limited.ok) throw rateLimited(limited.retryAfterSeconds, "follows")
	try {
		const result = await subscribe(userId, address)
		if (result.kind === "choices")
			throw new AppError("choose_feed", "This site has several feeds. Follow one of these URLs.", {
				details: { choices: result.links },
			})
		return { subscriptionId: result.subscriptionId, title: result.title, existing: result.existing }
	} catch (error) {
		if (error instanceof AppError) limited.refund()
		throw error
	}
}

/** Stops following a feed and forgets its views and dismissals. Saved articles stay. */
export async function unfollowFeed(userId: string, subscriptionId: string) {
	await mayUseFeeds(userId)
	if (!(await unsubscribe(userId, one(subscriptionId)))) throw notFound(NO_FEED)
}

const Title = z.string().max(FEED_TITLE_MAX).refine(withoutNul, NUL_REFUSED)

/** The user's own name for a feed; an empty one goes back to the feed's. */
export async function renameFeed(userId: string, subscriptionId: string, title: string) {
	await mayUseFeeds(userId)
	const clean = parseInput(Title, title.trim())
	if (!(await renameSubscription(userId, one(subscriptionId), clean))) throw notFound(NO_FEED)
}

/** Hides posts from the feed page. `notFound`: not posts in the user's feed. */
export async function dismissFeedItems(userId: string, ids: string[]) {
	await mayUseFeeds(userId)
	const list = parseInput(
		Ids.transform((all) => [...new Set(all)]),
		ids,
	)
	const dismissed: string[] = []
	const missing: string[] = []
	for (const id of list) ((await dismissOne(userId, id)) ? dismissed : missing).push(id)
	return { dismissed, notFound: missing }
}

export async function dismissFeedItem(userId: string, itemId: string) {
	const { notFound: missing } = await dismissFeedItems(userId, [itemId])
	if (missing.length > 0) throw notFound(NO_POST)
}

/** Undo of a dismissal. */
export async function restoreFeedItem(userId: string, itemId: string) {
	await mayUseFeeds(userId)
	if (!(await restoreOne(userId, one(itemId)))) throw notFound(NO_POST)
}

/** The reader opened a post: it is no longer new. */
export async function markFeedItemRead(userId: string, itemId: string) {
	await mayUseFeeds(userId)
	if (!(await markFeedItemViewed(userId, one(itemId)))) throw notFound(NO_POST)
}

/**
 * Posts that were new as of `asOf` are no longer new. Never later than now: that would hide posts
 * that arrive after.
 */
export async function markFeedViewed(userId: string, asOf: string) {
	await mayUseFeeds(userId)
	const at = new Date(parseInput(Time, asOf))
	const viewedAt = at.getTime() > Date.now() ? new Date() : at
	await markViewed(userId, viewedAt)
	return { viewedAt }
}

/**
 * Follows every feed of an OPML file (nothing is fetched here; each new feed's first fetch is
 * queued). Imports count against their own limit: each may queue hundreds of fetches.
 */
export async function importFeeds(userId: string, opml: string) {
	await mayUseFeeds(userId)
	const limited = rateLimit(
		`opml-import:${userId}`,
		OPML_IMPORT_LIMIT.limit,
		OPML_IMPORT_LIMIT.windowMs,
	)
	if (!limited.ok) throw rateLimited(limited.retryAfterSeconds, "imports")
	try {
		return await importOpml(userId, opml)
	} catch (error) {
		if (error instanceof AppError) limited.refund()
		throw error
	}
}
