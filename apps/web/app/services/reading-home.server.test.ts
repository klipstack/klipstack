import { db, documents, eq, feeds, feedItems, subscriptions, user } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { homeShelves } from "~/lib/home-shelves"
import { dismissFeedItem, markFeedItemViewed, markFeedViewed } from "./feeds.server"
import { readingHome } from "./reading-home.server"

const userId = `test-home-${Date.now()}`
const emptyId = `${userId}-empty`
const sparseId = `${userId}-sparse`
const accountIds = [userId, emptyId, sparseId]
// The test articles were saved in September 2026: more than two weeks before this.
const now = new Date("2026-10-10T12:00:00Z")
const titles = (docs: { title: string | null }[]) => docs.map((d) => d.title)
const shelves = async (id: string, minutes: number | null = null) =>
	homeShelves((await readingHome(id, { now })).candidates, minutes)

beforeAll(async () => {
	await db
		.insert(user)
		.values(
			[userId, emptyId, sparseId].map((id) => ({ id, name: "Reader", email: `${id}@example.com` })),
		)
	for (let i = 0; i < 12; i++) {
		await db.insert(documents).values({
			userId,
			title: `Article ${i}`,
			sourceUrl: `https://example.com/${i}`,
			urlHash: `${userId}-${i}`,
			status: "ready",
			readingMinutes: 5,
			createdAt: new Date(2026, 8, i + 1),
			firstOpenedAt: i < 4 ? new Date(2026, 8, 20) : null,
			lastReadAt: i < 4 ? new Date(2026, 8, 20, i) : null,
			readingProgress: i < 4 ? 0.4 : 0,
		})
	}
	for (const extra of [
		{ status: "processing" as const },
		{ status: "failed" as const },
		{ archivedAt: new Date() },
		{ deletedAt: new Date() },
		{ readAt: new Date(), firstOpenedAt: new Date() },
		{ readingProgress: 1, firstOpenedAt: new Date() },
	]) {
		await db.insert(documents).values({
			userId,
			title: "Excluded",
			sourceUrl: "https://example.com/excluded",
			urlHash: crypto.randomUUID(),
			status: "ready",
			readingMinutes: 3,
			...extra,
		})
	}
	await db.insert(documents).values({
		userId: sparseId,
		title: "Only article",
		sourceUrl: "https://example.com/only",
		urlHash: sparseId,
		status: "ready",
		readingMinutes: 2,
	})
})

afterAll(async () => {
	for (const id of accountIds) await db.delete(user).where(eq(user.id, id))
})

describe("home selections", () => {
	it("shows distinct ready inbox articles, with recent reading first", async () => {
		const home = await readingHome(userId, { now })
		expect(home.emptyState).toBeNull()
		// Twelve unfinished articles: more than Home shows at once.
		expect(home.timeChoice).toBe(true)
		const { reading, recent, rediscover } = homeShelves(home.candidates, null)
		expect(titles(reading)).toEqual(["Article 3", "Article 2", "Article 1"])
		expect(titles(recent)).toEqual(["Article 11", "Article 10", "Article 9"])
		// Three of the older unread saves, in the day's order.
		const older = ["Article 4", "Article 5", "Article 6", "Article 7", "Article 8"]
		expect(rediscover).toHaveLength(3)
		expect(older).toEqual(expect.arrayContaining(titles(rediscover)))
		const all = [...reading, ...recent, ...rediscover]
		expect(new Set(all.map((d) => d.id)).size).toBe(9)
	})

	it("narrows every section to the time chosen, from what it already has", async () => {
		const id = `${userId}-${crypto.randomUUID()}`
		accountIds.push(id)
		await db.insert(user).values({ id, name: "Reader", email: `${id}@example.com` })
		await db.insert(documents).values(
			[3, 40, 12, 40, 4, 90].map((readingMinutes, i) => ({
				userId: id,
				title: `Saved ${i}`,
				sourceUrl: `https://example.com/timed/${i}`,
				urlHash: `${id}-${i}`,
				status: "ready" as const,
				readingMinutes,
				createdAt: new Date(2026, 9, 9, i),
			})),
		)
		await db.insert(documents).values({
			userId: id,
			title: "Half of forty",
			sourceUrl: "https://example.com/timed/half",
			urlHash: `${id}-half`,
			status: "ready",
			readingMinutes: 40,
			readingProgress: 0.5,
			firstOpenedAt: new Date(2026, 9, 9),
		})
		// Seven unfinished articles: Home shows them all, so there is nothing to choose.
		expect((await readingHome(id, { now })).timeChoice).toBe(false)
		const any = await shelves(id)
		expect(titles(any.reading)).toEqual(["Half of forty"])
		expect(titles(any.recent)).toEqual(["Saved 5", "Saved 4", "Saved 3"])
		const five = await shelves(id, 5)
		// Half of forty can't be finished in five minutes, but it was read last: it stays first.
		expect(titles(five.reading)).toEqual(["Half of forty"])
		expect(titles(five.recent)).toEqual(["Saved 4", "Saved 0"])
		// What fills at least half the time first, then the rest that fits, newest first in each.
		const fifteen = await shelves(id, 15)
		expect(titles(fifteen.recent)).toEqual(["Saved 2", "Saved 4", "Saved 0"])
		const half = await shelves(id, 30)
		expect(titles(half.reading)).toEqual(["Half of forty"])
		expect(titles(half.recent)).toEqual(["Saved 4", "Saved 2", "Saved 0"])
		const hour = await shelves(id, 60)
		expect(titles(hour.recent)).toEqual(["Saved 3", "Saved 1", "Saved 4"])
	})

	it("gives the newest save the big card, and three more, when nothing is in progress", async () => {
		const id = `${userId}-${crypto.randomUUID()}`
		accountIds.push(id)
		await db.insert(user).values({ id, name: "Reader", email: `${id}@example.com` })
		await db.insert(documents).values(
			Array.from({ length: 6 }, (_, i) => ({
				userId: id,
				title: `Unread ${i}`,
				sourceUrl: `https://example.com/unread/${i}`,
				urlHash: `${id}-${i}`,
				status: "ready" as const,
				readingMinutes: 5,
				createdAt: new Date(2026, 8, i + 1),
			})),
		)
		const home = await shelves(id)
		expect(home.reading).toEqual([])
		expect(titles(home.recent)).toEqual(["Unread 5", "Unread 4", "Unread 3", "Unread 2"])
		// The older saves the recent ones don't already show.
		expect(titles(home.rediscover).sort()).toEqual(["Unread 0", "Unread 1"])
	})

	it("shrinks for sparse and empty libraries without borrowing another user's articles", async () => {
		expect(await readingHome(emptyId)).toEqual({
			candidates: {
				reading: [],
				recent: [],
				again: [],
				rediscover: [],
				recentSince: expect.any(Date),
			},
			timeChoice: false,
			feed: [],
			emptyState: { kind: "new", to: "/add" },
			review: false,
		})
		expect((await readingHome(sparseId)).emptyState).toBeNull()
		const sparse = await shelves(sparseId)
		expect(sparse.reading).toEqual([])
		expect(sparse.rediscover).toEqual([])
		expect(titles(sparse.recent)).toEqual(["Only article"])
	})

	it.each([
		{
			label: "finished articles still in the library",
			saves: [{ firstOpenedAt: new Date(), readAt: new Date() }],
			expected: { kind: "caughtUp", to: "/library" },
		},
		{
			label: "pending and failed saves that are archived or trashed",
			saves: [
				{ status: "processing", archivedAt: new Date() },
				{ status: "failed", archivedAt: new Date() },
				{ status: "queued", deletedAt: new Date() },
				{ status: "failed", deletedAt: new Date() },
			],
			expected: { kind: "caughtUp", to: "/archive" },
		},
		{
			label: "processing articles alongside failed saves",
			saves: [{ status: "processing" }, { status: "failed" }],
			expected: { kind: "processing", to: "/library" },
		},
		{
			label: "failed saves alongside archived articles",
			saves: [{ status: "failed" }, { archivedAt: new Date() }],
			expected: { kind: "failed", to: "/library" },
		},
	] as const)("explains $label", async ({ saves, expected }) => {
		const id = `${userId}-${crypto.randomUUID()}`
		accountIds.push(id)
		await db.insert(user).values({ id, name: "Reader", email: `${id}@example.com` })
		await db.insert(documents).values(
			saves.map((save, i) => ({
				userId: id,
				sourceUrl: `https://example.com/empty-state/${i}`,
				urlHash: `${id}-${i}`,
				status: "ready" as const,
				...save,
			})),
		)
		expect(await readingHome(id)).toEqual({
			candidates: {
				reading: [],
				recent: [],
				again: [],
				rediscover: [],
				recentSince: expect.any(Date),
			},
			timeChoice: false,
			feed: [],
			emptyState: expected,
			review: false,
		})
	})
})

describe("Home feed discovery", () => {
	const ownerId = `${userId}-feeds`
	const feedIds: string[] = []
	const viewedIds: string[] = []
	beforeAll(async () => {
		await db.insert(user).values({ id: ownerId, name: "Reader", email: `${ownerId}@example.com` })
		const now = Date.now()
		const hour = 3_600_000
		for (const [source, posts] of [
			[
				"Busy",
				[
					["Newest", 1],
					["Second", 2],
					["Third", 3],
				],
			],
			[
				"Another",
				[
					["Newest", 1.5],
					["Different", 4],
				],
			],
			["Quiet", [["Occasional post", 10]]],
			["Saved", [["Already saved", 0.1]]],
			["Opened", [["Already opened", 0.2]]],
			["Dismissed", [["Already dismissed", 0.3]]],
			["Expired", [["Older discovery", 15 * 24]]],
		] as const) {
			const [feed] = await db
				.insert(feeds)
				.values({
					url: `https://example.com/${ownerId}/${source}`,
					urlHash: `${ownerId}-${source}`,
					title: source,
				})
				.returning()
			feedIds.push(feed!.id)
			await db.insert(subscriptions).values({
				userId: ownerId,
				feedId: feed!.id,
				title: source === "Another" ? "My renamed blog" : null,
				createdAt: new Date(now - 30 * 24 * hour),
			})
			for (const [title, age] of posts) {
				const url = `https://example.com/${ownerId}/${encodeURIComponent(title)}`
				const urlHash = `${ownerId}-${title}`
				const [item] = await db
					.insert(feedItems)
					.values({
						feedId: feed!.id,
						guid: title,
						title,
						url,
						urlHash,
						sortAt: new Date(now - age * hour),
						firstSeenAt: new Date(now - age * hour),
					})
					.returning()
				if (source === "Saved")
					await db.insert(documents).values({
						userId: ownerId,
						sourceUrl: url,
						urlHash,
						status: "ready",
						archivedAt: new Date(),
					})
				if (source === "Opened") await markFeedItemViewed(ownerId, item!.id)
				if (source === "Dismissed") await dismissFeedItem(ownerId, item!.id)
				if (source === "Another" || source === "Quiet") viewedIds.push(item!.id)
			}
		}
	})
	afterAll(async () => {
		await db.delete(user).where(eq(user.id, ownerId))
		for (const id of feedIds) await db.delete(feeds).where(eq(feeds.id, id))
	})
	it("features new posts from different sources and hides the library empty state", async () => {
		const home = await readingHome(ownerId)
		expect(home.feed.map(({ item }) => item.title)).toEqual([
			"Newest",
			"Different",
			"Occasional post",
		])
		expect(home.feed.map(({ source }) => source)).toEqual(["Busy", "My renamed blog", "Quiet"])
		expect(new Set(home.feed.map(({ item }) => item.url)).size).toBe(3)
		expect(home.emptyState).toBeNull()
		expect(home.candidates.recent).toEqual([])
		expect((await readingHome(emptyId)).feed).toEqual([])
	})
	it("leaves feed posts out of a topic, which they are never in, and an empty topic is not an empty library", async () => {
		const home = await readingHome(ownerId, { topicId: crypto.randomUUID() })
		expect(home.feed).toEqual([])
		expect(home.emptyState).toBeNull()
	})
	it("can use one active source without showing saved, opened, dismissed, or expired posts", async () => {
		for (const id of viewedIds) await markFeedItemViewed(ownerId, id)
		const home = await readingHome(ownerId)
		expect(home.feed.map(({ item }) => item.title)).toEqual(["Newest", "Second", "Third"])
		await markFeedViewed(ownerId, new Date())
		expect((await readingHome(ownerId)).feed).toEqual([])
		expect((await readingHome(ownerId)).emptyState).toEqual({ kind: "caughtUp", to: "/archive" })
	})
})
