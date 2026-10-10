import { type FeedPage, getFeed as getFeedEndpoint } from "@klipstack/api-contract"
import {
	db,
	documents,
	eq,
	feedItemViews,
	feeds,
	sql,
	storeFeedEntries,
	subscriptions,
	user as userTable,
} from "@klipstack/db"
import { urlHash } from "@klipstack/extract"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { feed as getFeed } from "~/api/handlers/library.server"
import { saveFeedItem } from "~/commands/saving.server"
import {
	countNewFeedItems,
	dismissFeedItem,
	type FeedItemCursor,
	listFeedPage,
	markFeedViewed,
	markFeedItemViewed,
	restoreFeedItem,
	subscribe,
	unsubscribe,
} from "./feeds.server"

const stamp = Date.now()
const userId = `test-feeds-${stamp}`
const otherId = `test-feeds-other-${stamp}`
const feedUrl = `https://feeds-test-${stamp}.example.com/feed`
let feedId: string

const day = (n: number) => new Date(Date.UTC(2026, 8, n))
const entry = (n: number) => {
	const url = `https://feeds-test-${stamp}.example.com/post-${n}`
	return {
		guid: `post-${n}`,
		url,
		urlHash: urlHash(url),
		title: `Post ${n}`,
		author: null,
		excerpt: `Excerpt ${n}`,
		publishedAt: day(n),
	}
}

beforeAll(async () => {
	await db.insert(userTable).values([
		{ id: userId, name: "Feeds", email: `${userId}@example.com` },
		{ id: otherId, name: "Other", email: `${otherId}@example.com` },
	])
	const [feed] = await db
		.insert(feeds)
		.values({ url: feedUrl, urlHash: urlHash(feedUrl), title: "Test blog" })
		.returning({ id: feeds.id })
	feedId = feed!.id
	// Eight posts from before anyone subscribed, first seen a while ago.
	await storeFeedEntries(feedId, [1, 2, 3, 4, 5, 6, 7, 8].map(entry), day(10))
})

afterAll(async () => {
	await db.delete(userTable).where(eq(userTable.id, userId))
	await db.delete(userTable).where(eq(userTable.id, otherId))
	await db.delete(feeds).where(eq(feeds.id, feedId))
})

const titles = async (id = userId) =>
	(await listFeedPage(id)).sections.flatMap((s) => s.items.map((i) => i.title))

describe("feeds", () => {
	it("subscribes to a known feed without fetching, showing its latest five", async () => {
		const result = await subscribe(userId, feedUrl)
		expect(result).toMatchObject({ kind: "subscribed", title: "Test blog", existing: false })
		expect(await titles()).toEqual(["Post 8", "Post 7", "Post 6", "Post 5", "Post 4"])
		expect(await countNewFeedItems(userId)).toBe(5)

		const again = await subscribe(userId, feedUrl)
		expect(again).toMatchObject({ kind: "subscribed", existing: true })
	})

	it("orders sections by their latest item, with real dates", async () => {
		const url = `https://feeds-test-${stamp}.example.com/other`
		const [other] = await db
			.insert(feeds)
			.values({ url, urlHash: urlHash(url), title: "Other blog" })
			.returning({ id: feeds.id })
		await storeFeedEntries(other!.id, [
			{ ...entry(12), guid: "fresh", url: `${url}/fresh`, urlHash: urlHash(`${url}/fresh`) },
		])
		await subscribe(userId, url)
		const page = await listFeedPage(userId)
		expect(page.sections.map((s) => s.title)).toEqual(["Other blog", "Test blog"])
		expect(page.sections[0]?.items[0]?.sortAt).toBeInstanceOf(Date)
		expect(page.sections[0]?.items[0]?.publishedAt).toEqual(day(12))
		await db.delete(feeds).where(eq(feeds.id, other!.id))
	})

	it("gives undated items no publish date, and quiet feeds no last post", async () => {
		const url = `https://feeds-test-${stamp}.example.com/undated`
		const [undated] = await db
			.insert(feeds)
			.values({ url, urlHash: urlHash(url), title: "Undated blog" })
			.returning({ id: feeds.id })
		await storeFeedEntries(undated!.id, [{ ...entry(1), guid: "u", publishedAt: null }])
		await subscribe(userId, url)
		const section = (await listFeedPage(userId)).sections.find((s) => s.title === "Undated blog")
		expect(section?.items[0]?.publishedAt).toBeNull()
		expect(section?.lastPostAt).toBeNull()
		expect(section?.hasItems).toBe(true)
		await db.delete(feeds).where(eq(feeds.id, undated!.id))
	})

	it("records an opening only for that post and user, idempotently", async () => {
		const item = (await listFeedPage(userId)).sections[0]!.items[0]!
		expect(await markFeedItemViewed(otherId, item.id)).toBe(false)
		expect(await markFeedItemViewed(userId, item.id)).toBe(true)
		expect(await markFeedItemViewed(userId, item.id)).toBe(true)
		expect(await countNewFeedItems(userId)).toBe(4)
		expect((await listFeedPage(userId)).sections[0]!.items[0]!.isNew).toBe(false)
		expect(
			await db.select().from(feedItemViews).where(eq(feedItemViews.userId, userId)),
		).toHaveLength(1)
		await subscribe(otherId, feedUrl)
		expect(await countNewFeedItems(otherId)).toBe(5)
		await unsubscribe(otherId, (await listFeedPage(otherId)).sections[0]!.id)
	})

	it("explicit bulk acknowledgement leaves later arrivals new", async () => {
		await markFeedViewed(userId, new Date())
		expect(await countNewFeedItems(userId)).toBe(0)
		const page = await listFeedPage(userId)
		expect(page.sections[0]?.items.every((i) => !i.isNew)).toBe(true)

		// An older entry showing up later (past the per-fetch cap, or backdated) stays hidden.
		await storeFeedEntries(feedId, [entry(9), { ...entry(0), guid: "late" }])
		const after = await listFeedPage(userId)
		expect(after.sections[0]?.items[0]?.title).toBe("Post 9")
		expect(after.sections[0]?.newCount).toBe(1)
		expect(await countNewFeedItems(userId)).toBe(1)
	})

	it("bulk acknowledgement leaves later subscriptions new even when their posts are old", async () => {
		const cutoff = new Date(Date.now() - 60_000)
		await subscribe(otherId, feedUrl)
		await db
			.update(subscriptions)
			.set({ createdAt: new Date(cutoff.getTime() + 1000) })
			.where(eq(subscriptions.userId, otherId))
		await markFeedViewed(otherId, cutoff)
		expect(await countNewFeedItems(otherId)).toBe(5)
		await unsubscribe(otherId, (await listFeedPage(otherId)).sections[0]!.id)
	})

	it("saving clears new without setting Library reading progress", async () => {
		const post = entry(9)
		const [doc] = await db
			.insert(documents)
			.values({
				userId,
				sourceUrl: post.url,
				urlHash: post.urlHash,
				status: "ready",
			})
			.returning()
		const item = (await listFeedPage(userId)).sections[0]!.items.find(
			(item) => item.title === "Post 9",
		)!
		expect(item.isNew).toBe(false)
		expect((await saveFeedItem(userId, item.id)).articleId).toBe(doc!.id)
		expect(await db.query.documents.findFirst({ where: eq(documents.id, doc!.id) })).toMatchObject({
			firstOpenedAt: null,
			readAt: null,
			readingProgress: 0,
		})
		await db.delete(documents).where(eq(documents.id, doc!.id))
		expect(await countNewFeedItems(userId)).toBe(0)
	})

	it("marks items saved when the user has the document, however it got there", async () => {
		const post = entry(8)
		const [doc] = await db
			.insert(documents)
			.values({ userId, sourceUrl: post.url, urlHash: post.urlHash, status: "ready" })
			.returning({ id: documents.id })
		const item = (await listFeedPage(userId)).sections[0]?.items.find((i) => i.title === "Post 8")
		expect(item?.documentId).toBe(doc!.id)
		await db.delete(documents).where(eq(documents.id, doc!.id))
	})

	it("hides dismissed items until restored", async () => {
		const page = await listFeedPage(userId)
		const item = page.sections[0]?.items.find((i) => i.title === "Post 7")
		await dismissFeedItem(userId, item!.id)
		expect(await titles()).not.toContain("Post 7")
		await restoreFeedItem(userId, item!.id)
		expect(await titles()).toContain("Post 7")
	})

	it("does not let a user dismiss items from feeds they do not follow", async () => {
		const page = await listFeedPage(userId)
		const item = page.sections[0]?.items[0]
		await dismissFeedItem(otherId, item!.id)
		expect(await titles()).toContain(item!.title)
	})

	it("moves a subscription to the quiet list when nothing is left, and unsubscribes", async () => {
		const page = await listFeedPage(userId)
		for (const item of page.sections[0]?.items ?? []) await dismissFeedItem(userId, item.id)
		const quiet = await listFeedPage(userId)
		expect(quiet.sections).toEqual([])
		expect(quiet.quiet.map((s) => s.title)).toEqual(["Test blog"])

		await unsubscribe(userId, quiet.quiet[0]!.id)
		expect(await listFeedPage(userId)).toEqual({ sections: [], quiet: [] })
	})
})

it("expires new status after 14 days of availability, keeping older posts accessible", async () => {
	const id = `test-feed-expiry-${stamp}`
	const url = `https://feeds-test-${stamp}.example.com/expiry`
	await db.insert(userTable).values({ id, name: "Expiry", email: `${id}@example.com` })
	const [feed] = await db
		.insert(feeds)
		.values({ url, urlHash: urlHash(url) })
		.returning()
	try {
		const now = Date.now()
		const ages = [14 * 24 - 1, 14 * 24 + 1, 40 * 24]
		for (const [i, hours] of ages.entries()) {
			await storeFeedEntries(
				feed!.id,
				[{ ...entry(i + 1), publishedAt: null }],
				new Date(now - hours * 3_600_000),
			)
		}
		await db.insert(subscriptions).values({
			userId: id,
			feedId: feed!.id,
			createdAt: new Date(now - 50 * 86_400_000),
		})
		expect(await countNewFeedItems(id)).toBe(1)
		const page = await listFeedPage(id)
		expect(page.sections[0]!.items).toHaveLength(3)
		expect(page.sections[0]!.items.map((item) => item.isNew)).toEqual([true, false, false])
		expect((await listFeedPage(id, { newOnly: true })).sections[0]!.items).toHaveLength(1)
		// A fetch mentioning an old entry again does not renew its discovery window.
		await storeFeedEntries(feed!.id, [{ ...entry(3), publishedAt: null }])
		expect(await countNewFeedItems(id)).toBe(1)
		// Newly following this old feed gives its initial posts a full window of their own.
		await db
			.update(subscriptions)
			.set({ createdAt: sql`now()` })
			.where(eq(subscriptions.userId, id))
		expect(await countNewFeedItems(id)).toBe(3)
		await listFeedPage(id)
		expect(await countNewFeedItems(id)).toBe(3)
	} finally {
		await db.delete(userTable).where(eq(userTable.id, id))
		await db.delete(feeds).where(eq(feeds.id, feed!.id))
	}
})

describe("a long feed", () => {
	const longUser = `test-feeds-long-${stamp}`
	const longUrl = `https://feeds-test-${stamp}.example.com/long`
	let longFeed: string
	let subscriptionId: string
	// 60 posts; the three oldest share a date, so only the id orders them.
	const post = (n: number) => ({
		...entry(n),
		guid: `long-${n}`,
		url: `${longUrl}/${n}`,
		urlHash: urlHash(`${longUrl}/${n}`),
		title: `Long ${n}`,
		publishedAt: new Date(Date.UTC(2026, 0, 1, 0, Math.max(n, 3))),
	})
	const numbers = Array.from({ length: 60 }, (_, i) => i + 1)

	beforeAll(async () => {
		await db
			.insert(userTable)
			.values({ id: longUser, name: "Long", email: `${longUser}@example.com` })
		const [row] = await db
			.insert(feeds)
			.values({ url: longUrl, urlHash: urlHash(longUrl), title: "Long blog" })
			.returning({ id: feeds.id })
		longFeed = row!.id
		// Stored in two fetches: one takes 50 at most.
		await storeFeedEntries(longFeed, numbers.slice(0, 30).map(post))
		await storeFeedEntries(longFeed, numbers.slice(30).map(post))
		const result = await subscribe(longUser, longUrl)
		if (result.kind !== "subscribed") throw new Error("not subscribed")
		subscriptionId = result.subscriptionId
		// Every post shows, not only the latest few.
		await db.update(subscriptions).set({ since: null }).where(eq(subscriptions.id, subscriptionId))
	})

	afterAll(async () => {
		await db.delete(userTable).where(eq(userTable.id, longUser))
		await db.delete(feeds).where(eq(feeds.id, longFeed))
	})

	const section = async (options: Parameters<typeof listFeedPage>[1]) =>
		(await listFeedPage(longUser, options)).sections[0]

	it("counts what the limit leaves out", async () => {
		const first = await section({ perFeed: 10 })
		expect(first?.items.map((i) => i.title)).toEqual(
			numbers
				.slice(-10)
				.reverse()
				.map((n) => `Long ${n}`),
		)
		expect(first).toMatchObject({ newCount: 60, moreItems: 50 })
	})

	it("filters before the limit: unsaved posts past the first 50 still show", async () => {
		const saved = numbers.slice(-50)
		await db.insert(documents).values(
			saved.map((n) => ({
				userId: longUser,
				sourceUrl: post(n).url,
				urlHash: post(n).urlHash,
				status: "ready" as const,
			})),
		)
		const fresh = await section({ newOnly: true, perFeed: 50 })
		expect(fresh?.items.map((i) => i.title)).toEqual(
			numbers
				.slice(0, 10)
				.reverse()
				.map((n) => `Long ${n}`),
		)
		expect(fresh).toMatchObject({ newCount: 10, moreItems: 0 })
		expect(await section({ perFeed: 50 })).toMatchObject({ moreItems: 10 })
		await db.delete(documents).where(eq(documents.userId, longUser))
	})

	it("pages through every post once, ties included", async () => {
		const seen: string[] = []
		let after: FeedItemCursor | null = null
		for (let page = 0; page < 10; page++) {
			const current = await section({ subscriptionId, perFeed: 7, after })
			if (!current) break
			seen.push(...current.items.map((i) => i.title ?? ""))
			const last = current.items.at(-1)!
			after = { sortKey: last.sortKey, id: last.id }
			if (current.moreItems === 0) break
		}
		expect(seen).toHaveLength(60)
		expect(new Set(seen).size).toBe(60)
	})

	it("pages through the API with nextCursor, for a feed id in any case", async () => {
		// The query as the router hands it over: parsed by the contract.
		const call = async (query: Record<string, unknown>) =>
			(await getFeed({
				userId: longUser,
				query: getFeedEndpoint.query.parse({ perFeed: "25", ...query }),
			} as unknown as Parameters<typeof getFeed>[0])) as FeedPage
		const ids: string[] = []
		let cursor: string | undefined
		for (let page = 0; page < 5; page++) {
			const result = await call({ feed: subscriptionId.toUpperCase(), cursor })
			const [only] = result.feeds
			ids.push(...(only?.items.map((i) => i.id) ?? []))
			cursor = only?.nextCursor ?? undefined
			if (!cursor) break
		}
		expect(ids).toHaveLength(60)
		expect(new Set(ids).size).toBe(60)
		// A cursor carries its feed: passing another one is a 400.
		const first = await call({})
		const next = first.feeds[0]?.nextCursor ?? ""
		await expect(
			call({ feed: "00000000-0000-7000-8000-000000000000", cursor: next }),
		).rejects.toMatchObject({ code: "invalid_request" })
	})
})
