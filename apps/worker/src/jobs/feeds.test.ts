import { randomUUID } from "node:crypto"
import { db, eq, feedItems, feeds, pool, subscriptions, user } from "@klipstack/db"
import { ExtractError, type FetchedPage, urlHash } from "@klipstack/extract"
import { stopBoss } from "@klipstack/queue"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const notify = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock("@klipstack/db", async (original) => ({
	...(await original<typeof import("@klipstack/db")>()),
	notifyDocumentEvent: notify,
}))
const fetchFeed = vi.hoisted(() => vi.fn())
vi.mock("@klipstack/extract", async (original) => ({
	...(await original<typeof import("@klipstack/extract")>()),
	fetchFeed,
}))
const enqueue = vi.hoisted(() => vi.fn(async () => "job"))
vi.mock("@klipstack/queue", async (original) => ({
	...(await original<typeof import("@klipstack/queue")>()),
	enqueue,
}))

const { FETCH_INTERVAL_MS, handleFeedFetch, handleFeedsTick } = await import("./feeds")

const userId = `feeds-${randomUUID()}`
const created: string[] = []
const HOUR = 3_600_000

const rss = (items: number[]) => `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Busy blog</title><link>https://blog.example/</link>
${items
	.map(
		(n) =>
			`<item><title>Post ${n}</title><link>https://blog.example/${n}</link><guid>${n}</guid><pubDate>Mon, 0${n} Sep 2026 10:00:00 GMT</pubDate></item>`,
	)
	.join("")}
</channel></rss>`

const page = (over: Partial<FetchedPage>): FetchedPage => ({
	html: "",
	finalUrl: "https://blog.example/feed.xml",
	status: 200,
	contentType: "application/rss+xml",
	etag: null,
	lastModified: null,
	...over,
})

async function feed(followed = true) {
	const url = `https://blog.example/${randomUUID()}/feed.xml`
	const [row] = await db
		.insert(feeds)
		.values({ url, urlHash: urlHash(url), nextFetchAt: new Date(Date.now() - 1000) })
		.returning()
	created.push(row!.id)
	if (followed) await db.insert(subscriptions).values({ userId, feedId: row!.id })
	return row!
}
const stored = async (id: string) => (await db.query.feeds.findFirst({ where: eq(feeds.id, id) }))!
const items = async (id: string) =>
	(await db.select().from(feedItems).where(eq(feedItems.feedId, id))).map((i) => i.guid).sort()
const fetch = (feedId: string) => handleFeedFetch({ data: { feedId } } as never)
/** Due now, as the tick finds it. */
const due = (id: string) =>
	db.update(feeds).set({ nextFetchAt: new Date() }).where(eq(feeds.id, id))
/** Hours from now to the feed's next fetch. */
const hoursToNext = async (id: string) =>
	((await stored(id)).nextFetchAt.getTime() - Date.now()) / HOUR

beforeAll(async () => {
	await db
		.insert(user)
		.values({ id: userId, name: "Feeds", email: `${userId}@example.com`, prefs: { feeds: "on" } })
})
beforeEach(() => {
	fetchFeed.mockReset()
	notify.mockClear()
	enqueue.mockClear()
})
afterAll(async () => {
	await db.delete(user).where(eq(user.id, userId))
	for (const id of created) await db.delete(feeds).where(eq(feeds.id, id))
	await stopBoss()
	await pool.end()
})

describe("handleFeedFetch", () => {
	it("stores new posts once, asks again with the validators, and tells the followers", async () => {
		const { id } = await feed()
		fetchFeed.mockResolvedValueOnce(page({ html: rss([1, 2]), etag: '"v1"', lastModified: "then" }))
		await fetch(id)
		expect(await items(id)).toEqual(["1", "2"])
		expect(await stored(id)).toMatchObject({
			title: "Busy blog",
			etag: '"v1"',
			lastModified: "then",
			errorCount: 0,
		})
		expect(await hoursToNext(id)).toBeCloseTo(FETCH_INTERVAL_MS / HOUR, 0)
		expect(notify).toHaveBeenCalledWith({ userId, kind: "feed" })

		// Nothing changed: a 304 to the conditional request.
		notify.mockClear()
		await due(id)
		fetchFeed.mockResolvedValueOnce(page({ status: 304 }))
		await fetch(id)
		expect(fetchFeed).toHaveBeenLastCalledWith(expect.any(String), {
			headers: { "if-none-match": '"v1"', "if-modified-since": "then" },
		})
		// The same posts again, and one new: only the new one is added.
		await due(id)
		fetchFeed.mockResolvedValueOnce(page({ html: rss([1, 2, 3]) }))
		await fetch(id)
		expect(await items(id)).toEqual(["1", "2", "3"])
		expect(notify).toHaveBeenCalledTimes(1)
	})

	it("starts the followers of a never-fetched feed at its latest five, and names it", async () => {
		// As an OPML import leaves it: followed under the feed's own name or another, never fetched.
		const { id } = await feed(false)
		const renamer = `${userId}-renamer`
		await db.insert(user).values({ id: renamer, name: "Renamer", email: `${renamer}@example.com` })
		await db.insert(subscriptions).values([
			{ userId, feedId: id, title: "Busy blog" },
			{ userId: renamer, feedId: id, title: "My name for it" },
		])
		fetchFeed.mockResolvedValueOnce(page({ html: rss([1, 2, 3, 4, 5, 6, 7, 8]) }))
		await fetch(id)
		const followed = async (who: string) =>
			(await db.select().from(subscriptions).where(eq(subscriptions.userId, who))).find(
				(s) => s.feedId === id,
			)
		// Post 4 is the fifth newest.
		const fifth = new Date("2026-09-04T10:00:00Z")
		expect(await followed(userId)).toMatchObject({ since: fifth, title: null })
		expect(await followed(renamer)).toMatchObject({ since: fifth, title: "My name for it" })
		await db.delete(user).where(eq(user.id, renamer))
	})

	it("does nothing for a feed another job fetched and rescheduled meanwhile", async () => {
		const { id } = await feed()
		await db
			.update(feeds)
			.set({ nextFetchAt: new Date(Date.now() + HOUR) })
			.where(eq(feeds.id, id))
		await fetch(id)
		expect(fetchFeed).not.toHaveBeenCalled()
	})

	it("backs off after failures, as long as the server asks, and resets on success", async () => {
		const { id } = await feed()
		fetchFeed.mockRejectedValueOnce(new ExtractError("http_error", "down", { status: 503 }))
		await fetch(id)
		expect(await stored(id)).toMatchObject({ errorCount: 1, lastError: "http_error:503" })
		expect(await hoursToNext(id)).toBeCloseTo(2, 0)

		await due(id)
		fetchFeed.mockRejectedValueOnce(
			new ExtractError("http_error", "slow down", { status: 429, retryAfter: 10 * 3600 }),
		)
		await fetch(id)
		expect(await stored(id)).toMatchObject({ errorCount: 2, lastError: "http_error:429" })
		expect(await hoursToNext(id)).toBeCloseTo(10, 1)

		await due(id)
		fetchFeed.mockResolvedValueOnce(page({ html: rss([1]) }))
		await fetch(id)
		expect(await stored(id)).toMatchObject({ errorCount: 0, lastError: null })
	})
})

describe("handleFeedsTick", () => {
	it("queues and claims the due feeds someone follows, and only those", async () => {
		const followed = await feed()
		const orphan = await feed(false)
		// Followed only by an account with feeds turned off: not fetched for it.
		const off = `${userId}-off`
		await db.insert(user).values({ id: off, name: "Off", email: `${off}@example.com` })
		const idle = await feed(false)
		await db.insert(subscriptions).values({ userId: off, feedId: idle.id })
		try {
			await handleFeedsTick()
		} finally {
			await db.delete(user).where(eq(user.id, off))
		}
		expect(enqueue).toHaveBeenCalledWith(expect.any(String), { feedId: followed.id })
		expect(enqueue).not.toHaveBeenCalledWith(expect.any(String), { feedId: orphan.id })
		expect(enqueue).not.toHaveBeenCalledWith(expect.any(String), { feedId: idle.id })
		expect(await hoursToNext(followed.id)).toBeGreaterThan(0.2)
		expect(await hoursToNext(orphan.id)).toBeLessThan(0)

		// Claimed: the next tick leaves it alone.
		enqueue.mockClear()
		await handleFeedsTick()
		expect(enqueue).not.toHaveBeenCalledWith(expect.any(String), { feedId: followed.id })
	})

	it("leaves alone the feeds only lapsed accounts follow", async () => {
		// Made 45 days ago, 15 after billing started: its trial is over.
		const lapsed = `${userId}-lapsed`
		const DAY = 24 * 60 * 60 * 1000
		await db.insert(user).values({
			id: lapsed,
			name: "Lapsed",
			email: `${lapsed}@example.com`,
			prefs: { feeds: "on" },
			createdAt: new Date(Date.now() - 45 * DAY),
		})
		const theirs = await feed(false)
		const shared = await feed()
		await db.insert(subscriptions).values([
			{ userId: lapsed, feedId: theirs.id },
			{ userId: lapsed, feedId: shared.id },
		])
		process.env.BILLING_STARTS_AT = new Date(Date.now() - 60 * DAY).toISOString()
		enqueue.mockClear()
		try {
			await handleFeedsTick()
		} finally {
			delete process.env.BILLING_STARTS_AT
			await db.delete(user).where(eq(user.id, lapsed))
		}
		expect(enqueue).not.toHaveBeenCalledWith(expect.any(String), { feedId: theirs.id })
		// Someone in a trial follows it too.
		expect(enqueue).toHaveBeenCalledWith(expect.any(String), { feedId: shared.id })
	})
})
