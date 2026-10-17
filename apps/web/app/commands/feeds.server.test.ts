import { randomUUID } from "node:crypto"
import { FEED_TITLE_MAX } from "@klipstack/api-contract"
import { db, eq, feeds, user as userTable } from "@klipstack/db"
import { normalizeUrl, urlHash } from "@klipstack/extract"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "~/lib/env.server"
import { rateLimit, SAVE_LIMIT } from "~/lib/rate-limit.server"
import {
	dismissFeedItem,
	followFeed,
	markFeedViewed,
	renameFeed,
	restoreFeedItem,
	unfollowFeed,
} from "./feeds.server"

const userId = `test-feed-commands-${Date.now()}`
const feedUrl = `https://example.com/feed-commands-${Date.now()}/feed.xml`
let feedId: string

beforeAll(async () => {
	await db.insert(userTable).values({
		id: userId,
		name: "Follower",
		email: `${userId}@example.com`,
		prefs: { feeds: "on" },
	})
	// A feed someone follows already: following it again needs no fetch.
	const [feed] = await db
		.insert(feeds)
		.values({ url: normalizeUrl(feedUrl), urlHash: urlHash(normalizeUrl(feedUrl)), title: "Known" })
		.returning({ id: feeds.id })
	feedId = feed!.id
})

afterAll(async () => {
	await db.delete(userTable).where(eq(userTable.id, userId))
	await db.delete(feeds).where(eq(feeds.id, feedId))
})

describe("following", () => {
	it("follows, once, and a refused address costs nothing against the limit", async () => {
		for (let i = 0; i < SAVE_LIMIT.limit - 1; i++)
			rateLimit(`subscribe:${userId}`, SAVE_LIMIT.limit, SAVE_LIMIT.windowMs)
		await expect(followFeed(userId, "not a url")).rejects.toMatchObject({ code: "invalid_url" })
		const followed = await followFeed(userId, feedUrl)
		expect(followed).toMatchObject({ title: "Known", existing: false })
		await expect(followFeed(userId, feedUrl)).rejects.toMatchObject({ code: "rate_limited" })

		await renameFeed(userId, followed.subscriptionId, "  Mine  ")
		await expect(
			renameFeed(userId, followed.subscriptionId, "x".repeat(FEED_TITLE_MAX + 1)),
		).rejects.toMatchObject({ code: "invalid_request" })
		await unfollowFeed(userId, followed.subscriptionId)
		await expect(unfollowFeed(userId, followed.subscriptionId)).rejects.toMatchObject({
			code: "not_found",
		})
		await expect(renameFeed(userId, followed.subscriptionId, "Gone")).rejects.toMatchObject({
			code: "not_found",
		})
	})
})

describe("the feed cap", () => {
	it("refuses a new follow at the cap, never one the user has already", async () => {
		const cappedId = `${userId}-capped`
		await db.insert(userTable).values({
			id: cappedId,
			name: "Capped",
			email: `${cappedId}@example.com`,
			prefs: { feeds: "on" },
		})
		const otherUrl = `${feedUrl}.other`
		const [other] = await db
			.insert(feeds)
			.values({
				url: normalizeUrl(otherUrl),
				urlHash: urlHash(normalizeUrl(otherUrl)),
				title: "Other",
			})
			.returning({ id: feeds.id })
		const before = env.LIMIT_FEEDS
		env.LIMIT_FEEDS = 1
		try {
			await followFeed(cappedId, feedUrl)
			const refused = await followFeed(cappedId, otherUrl).catch((e: unknown) => e)
			expect(refused).toMatchObject({
				code: "limit_reached",
				status: 403,
				details: { limit: "feeds", max: 1 },
			})
			expect(await followFeed(cappedId, feedUrl)).toMatchObject({ existing: true })
		} finally {
			env.LIMIT_FEEDS = before
			await db.delete(userTable).where(eq(userTable.id, cappedId))
			await db.delete(feeds).where(eq(feeds.id, other!.id))
		}
	})
})

describe("posts", () => {
	it("refuses posts not in the user's feed", async () => {
		await expect(dismissFeedItem(userId, randomUUID())).rejects.toMatchObject({
			code: "not_found",
		})
		await expect(restoreFeedItem(userId, randomUUID())).rejects.toMatchObject({
			code: "not_found",
		})
		await expect(dismissFeedItem(userId, "not-an-id")).rejects.toMatchObject({
			code: "invalid_request",
		})
	})

	it("never marks the feed viewed later than now", async () => {
		const { viewedAt } = await markFeedViewed(userId, "2999-01-01T00:00:00Z")
		expect(viewedAt.getTime()).toBeLessThanOrEqual(Date.now())
		await expect(markFeedViewed(userId, "yesterday")).rejects.toMatchObject({
			code: "invalid_request",
		})
	})
})
