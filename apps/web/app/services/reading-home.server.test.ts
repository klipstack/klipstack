import { db, documents, eq, feeds, feedItems, subscriptions, user } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { dismissFeedItem, markFeedItemViewed, markFeedViewed } from "./feeds.server"
import { readingHome } from "./reading-home.server"

const userId = `test-home-${Date.now()}`
const emptyId = `${userId}-empty`
const sparseId = `${userId}-sparse`
const accountIds = [userId, emptyId, sparseId]
// The test articles were saved in September 2026: more than two weeks before this.
const now = new Date("2026-10-10T12:00:00Z")

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
		expect(home.reading.map((d) => d.title)).toEqual(["Article 3", "Article 2", "Article 1"])
		expect(home.recent.map((d) => d.title)).toEqual(["Article 11", "Article 10", "Article 9"])
		// Three of the older unread saves; the other two, then the one in progress, fit the time.
		const older = ["Article 4", "Article 5", "Article 6", "Article 7", "Article 8"]
		const rediscovered = home.rediscover.map((d) => d.title!)
		expect(rediscovered).toHaveLength(3)
		expect(older).toEqual(expect.arrayContaining(rediscovered))
		const rest = older.filter((title) => !rediscovered.includes(title)).reverse()
		expect(home.fits?.minutes).toBe(15)
		expect(home.fits?.items.map((d) => d.title)).toEqual([...rest, "Article 0"])
		const all = [...home.reading, ...home.recent, ...home.rediscover, ...home.fits!.items]
		expect(new Set(all.map((d) => d.id)).size).toBe(12)
	})

	it("keeps the time choices while a longer time has something to read", async () => {
		const home = await readingHome(userId, { minutes: 5, now })
		expect(home.fits?.minutes).toBe(5)
		expect(home.fits?.items.length).toBeGreaterThan(0)
		const id = `${userId}-${crypto.randomUUID()}`
		accountIds.push(id)
		await db.insert(user).values({ id, name: "Reader", email: `${id}@example.com` })
		await db.insert(documents).values(
			[90, 40, 40, 40, 40].map((readingMinutes, i) => ({
				userId: id,
				title: `Long ${i}`,
				sourceUrl: `https://example.com/long/${i}`,
				urlHash: `${id}-${i}`,
				status: "ready" as const,
				readingMinutes,
				createdAt: new Date(2026, 9, 9, i),
			})),
		)
		// The four newest are the big card and the recent saves; the oldest, 90 minutes, fits no time.
		expect((await readingHome(id, { now })).fits).toBeNull()
		await db
			.update(documents)
			.set({ readingMinutes: 50 })
			.where(eq(documents.urlHash, `${id}-0`))
		const longer = await readingHome(id, { minutes: 5, now })
		expect(longer.fits).toEqual({ minutes: 5, items: [] })
		const hour = await readingHome(id, { minutes: 60, now })
		expect(hour.fits?.items.map((d) => d.title)).toEqual(["Long 0"])
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
		const home = await readingHome(id, { now })
		expect(home.reading).toEqual([])
		expect(home.recent.map((d) => d.title)).toEqual([
			"Unread 5",
			"Unread 4",
			"Unread 3",
			"Unread 2",
		])
		expect(home.rediscover.map((d) => d.title).sort()).toEqual(["Unread 0", "Unread 1"])
		expect(home.fits).toBeNull()
	})

	it("shrinks for sparse and empty libraries without borrowing another user's articles", async () => {
		expect(await readingHome(emptyId)).toEqual({
			reading: [],
			recent: [],
			rediscover: [],
			fits: null,
			feed: [],
			emptyState: { kind: "new", to: "/add" },
		})
		const sparse = await readingHome(sparseId)
		expect(sparse.emptyState).toBeNull()
		expect(sparse.reading).toEqual([])
		expect(sparse.rediscover).toEqual([])
		expect(sparse.fits).toBeNull()
		expect(sparse.recent.map((d) => d.title)).toEqual(["Only article"])
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
			reading: [],
			recent: [],
			rediscover: [],
			fits: null,
			feed: [],
			emptyState: expected,
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
		expect(home.recent).toEqual([])
		expect((await readingHome(emptyId)).feed).toEqual([])
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
