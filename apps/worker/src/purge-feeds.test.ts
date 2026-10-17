import { asc, db, eq, feedItems, feeds, storeFeedEntries } from "@klipstack/db"
import { urlHash } from "@klipstack/extract"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { purgeFeeds } from "./jobs/purge"

const stamp = Date.now()
const feedUrl = `https://purge-test-${stamp}.example.com/feed`
let feedId: string

const DAY = 86_400_000
/** Eight posts, one a day, the newest 100 days ago: all past the retention period. */
const entries = Array.from({ length: 8 }, (_, i) => {
	const url = `https://purge-test-${stamp}.example.com/${i}`
	return {
		guid: `${i}`,
		url,
		urlHash: urlHash(url),
		title: `Old ${i}`,
		author: null,
		excerpt: null,
		publishedAt: new Date(Date.now() - (100 + i) * DAY),
	}
})

const guids = async () =>
	(
		await db
			.select({ guid: feedItems.guid })
			.from(feedItems)
			.where(eq(feedItems.feedId, feedId))
			.orderBy(asc(feedItems.guid))
	).map((r) => r.guid)

beforeAll(async () => {
	const [feed] = await db
		.insert(feeds)
		.values({ url: feedUrl, urlHash: urlHash(feedUrl) })
		.returning({ id: feeds.id })
	feedId = feed!.id
})

afterAll(async () => {
	await db.delete(feeds).where(eq(feeds.id, feedId))
})

describe("purgeFeeds", () => {
	it("keeps old items the feed still lists, so they do not come back as new", async () => {
		await storeFeedEntries(feedId, entries, new Date(Date.now() - 2 * DAY))
		await storeFeedEntries(feedId, entries, new Date(Date.now() - DAY))
		await purgeFeeds([feedId])
		expect(await guids()).toHaveLength(8)
	})

	it("drops old items once the feed stops listing them, keeping the latest five", async () => {
		// The feed now lists only its two newest posts.
		expect(await storeFeedEntries(feedId, entries.slice(0, 2))).toBe(0)
		await purgeFeeds([feedId])
		expect(await guids()).toEqual(["0", "1", "2", "3", "4"])
	})
})

describe("storeFeedEntries", () => {
	it("keeps the feed's order for undated entries", async () => {
		const [feed] = await db
			.insert(feeds)
			.values({ url: `${feedUrl}/undated`, urlHash: urlHash(`${feedUrl}/undated`) })
			.returning({ id: feeds.id })
		const undated = ["first", "second", "third"].map((guid) => ({
			...entries[0]!,
			guid,
			title: guid,
			publishedAt: null,
		}))
		await storeFeedEntries(feed!.id, undated)
		const rows = await db.query.feedItems.findMany({ where: eq(feedItems.feedId, feed!.id) })
		const bySort = [...rows].sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime())
		expect(bySort.map((r) => r.title)).toEqual(["first", "second", "third"])
		await db.delete(feeds).where(eq(feeds.id, feed!.id))
	})
})
