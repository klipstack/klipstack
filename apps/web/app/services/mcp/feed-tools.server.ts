import { BATCH_MAX, Ids, Time, URL_MAX } from "@klipstack/api-contract"
import type { McpServer } from "@modelcontextprotocol/server"
import { z } from "zod"
import { dismissFeedItems, followFeed, markFeedViewed, unfollowFeed } from "~/commands/feeds.server"
import { saveFeedItems } from "~/commands/saving.server"
import { AppError } from "~/lib/app-error"
import { type FeedSubscription, listFeedPage } from "../feeds.server"
import { uuid } from "./ids"
import { json, readerUrl, toolError } from "./results.server"

/**
 * The feed page: posts from the blogs the user follows, to save to the library or dismiss. Same
 * services and limits as /feed.
 */

/** Feed tools that change something (scope library:write). */
export const FEED_WRITE_TOOLS: ReadonlySet<string> = new Set([
	"save_feed_items",
	"dismiss_feed_items",
	"mark_feed_viewed",
	"follow_feed",
	"unfollow_feed",
])

const READ_ONLY = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
} as const

const WRITE = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
} as const

const itemIds = Ids

const NO_WRITE = "This connection may only read the library."

function feedSummary(sub: FeedSubscription) {
	return { id: sub.id, title: sub.title, siteUrl: sub.siteUrl, notUpdating: sub.trouble }
}

export function registerFeedTools(server: McpServer, userId: string, canWrite: boolean) {
	server.registerTool(
		"list_feed",
		{
			title: "List feed",
			description:
				"The user's feed page: posts from the blogs they follow, newest activity first, grouped by feed. A post stays new for 14 days after becoming available to the user, until opened, saved, or explicitly acknowledged. Listing or visiting Feed does not clear new status. savedArticleId is set once a post's link is in the library. save_feed_items adds posts to the library; dismiss_feed_items hides them. Feeds with nothing to show are listed apart.",
			inputSchema: z.object({
				new_only: z
					.boolean()
					.default(false)
					.describe("Only new posts that are not saved yet; feeds without any are left out"),
				feed_id: uuid().optional().describe("Only this feed"),
				items_per_feed: z.number().int().min(1).max(50).default(10),
			}),
			annotations: READ_ONLY,
		},
		async ({ new_only, feed_id, items_per_feed }) => {
			const listedAt = new Date().toISOString()
			const { sections, quiet } = await listFeedPage(userId, {
				subscriptionId: feed_id,
				newOnly: new_only,
				perFeed: items_per_feed,
			})
			const feeds = sections.map((section) => ({
				...feedSummary(section),
				newCount: section.newCount,
				items: section.items.map((i) => ({
					id: i.id,
					title: i.title,
					url: i.url,
					author: i.author,
					excerpt: i.excerpt,
					publishedAt: i.publishedAt?.toISOString() ?? null,
					new: i.isNew,
					savedArticleId: i.documentId,
				})),
				moreItems: section.moreItems,
			}))
			return json({ listedAt, feeds, quietFeeds: quiet.map(feedSummary) })
		},
	)

	server.registerTool(
		"save_feed_items",
		{
			title: "Save feed posts",
			description: `Saves up to ${BATCH_MAX} feed posts to the user's library, like the Save button on the feed page. Klipstack fetches and extracts each in the background. Returns the article id for each saved post, and the posts not found or not saved (with why).`,
			inputSchema: z.object({ ids: itemIds.describe("Post ids from list_feed") }),
			annotations: { ...WRITE, openWorldHint: true },
		},
		async ({ ids }) => {
			if (!canWrite) return toolError(NO_WRITE)
			const result = await saveFeedItems(userId, ids)
			return json({
				saved: result.saved.map((s) => ({ ...s, klipstackUrl: readerUrl(s.articleId) })),
				notFound: result.notFound,
				notSaved: result.notSaved.map((n) => ({ itemId: n.itemId, reason: n.message })),
			})
		},
	)

	server.registerTool(
		"dismiss_feed_items",
		{
			title: "Dismiss feed posts",
			description: `Hides up to ${BATCH_MAX} feed posts from the feed page, like its Dismiss button. The user can undo it there.`,
			inputSchema: z.object({ ids: itemIds.describe("Post ids from list_feed") }),
			annotations: WRITE,
		},
		async ({ ids }) => {
			if (!canWrite) return toolError(NO_WRITE)
			return json(await dismissFeedItems(userId, ids))
		},
	)

	server.registerTool(
		"mark_feed_viewed",
		{
			title: "Mark feed as viewed",
			description:
				"Explicitly acknowledges all currently new posts available up to as_of. Pass list_feed's listedAt so later arrivals stay new. Use only when the user asks to clear new posts; do not call merely because you listed or discussed the feed.",
			inputSchema: z.object({ as_of: Time }),
			annotations: WRITE,
		},
		async ({ as_of }) => {
			if (!canWrite) return toolError(NO_WRITE)
			const { viewedAt } = await markFeedViewed(userId, as_of)
			return json({ viewedAt: viewedAt.toISOString() })
		},
	)

	server.registerTool(
		"follow_feed",
		{
			title: "Follow a feed",
			description:
				"Follows a blog: pass its feed URL, or a site URL that links a feed. A site with several feeds returns them to choose from; call again with one. The feed's latest few posts show up in list_feed.",
			inputSchema: z.object({ url: z.string().trim().min(1).max(URL_MAX) }),
			annotations: { ...WRITE, openWorldHint: true },
		},
		async ({ url }) => {
			if (!canWrite) return toolError(NO_WRITE)
			try {
				const followed = await followFeed(userId, url)
				return json({
					followed: true,
					feed: { id: followed.subscriptionId, title: followed.title },
					alreadyFollowing: followed.existing,
				})
			} catch (error) {
				// Not a failure for an assistant: the feeds to choose from.
				if (error instanceof AppError && error.code === "choose_feed")
					return json({
						followed: false,
						message: "This site has several feeds. Call follow_feed again with one of these URLs.",
						choices: error.details?.choices,
					})
				throw error
			}
		},
	)

	server.registerTool(
		"unfollow_feed",
		{
			title: "Unfollow a feed",
			description:
				"Stops following a feed (its id from list_feed). Its posts leave the feed page; articles already saved from it stay in the library. Confirm with the user first.",
			inputSchema: z.object({ feed_id: uuid() }),
			annotations: { ...WRITE, destructiveHint: true },
		},
		async ({ feed_id }) => {
			if (!canWrite) return toolError(NO_WRITE)
			await unfollowFeed(userId, feed_id)
			return json({ id: feed_id, unfollowed: true })
		},
	)
}
