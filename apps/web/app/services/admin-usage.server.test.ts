import { randomUUID } from "node:crypto"
import { assets, db, subscriptions, feeds, inArray, usageCounts } from "@klipstack/db"
import { afterAll, describe, expect, it } from "vitest"
import { authorizeAdmin } from "~/lib/admin.server"
import { countRefusal, defaultLimits, monthOf } from "~/lib/limits.server"
import { adminFixtures } from "~/test/admin-fixtures"
import { listUsage } from "./admin-usage.server"

const fx = adminFixtures("admin-usage")
const feedIds: string[] = []
afterAll(async () => {
	await fx.cleanup()
	if (feedIds.length) await db.delete(feeds).where(inArray(feeds.id, feedIds))
})

const MB = 1024 * 1024

describe("listUsage", () => {
	it("ranks accounts by what was asked, with this month's counts and the caps", async () => {
		const ctx = await authorizeAdmin(await (await fx.account({ role: "admin" })).session())
		const heavy = await fx.account()
		const noisy = await fx.account()
		// Far past any test account's real usage, so these two lead the rankings.
		await db.insert(assets).values({
			userId: heavy.id,
			sha256: randomUUID(),
			storageKey: `test/${heavy.id}`,
			contentType: "image/webp",
			bytes: 900 * MB,
		})
		const { month } = monthOf()
		await db.insert(usageCounts).values([
			{ userId: heavy.id, metric: "saves", month, count: 12 },
			// Last month's count is not this month's.
			{ userId: heavy.id, metric: "saves", month: "2000-01-01", count: 99 },
			{ userId: noisy.id, metric: "saves", month, count: 300 },
			{ userId: noisy.id, metric: "refused", month, count: 999 },
		])
		await countRefusal(noisy.id)
		const url = `https://usage-${randomUUID()}.example/feed`
		const [feed] = await db
			.insert(feeds)
			.values({ url, urlHash: randomUUID() })
			.returning({ id: feeds.id })
		feedIds.push(feed!.id)
		await db.insert(subscriptions).values({ userId: noisy.id, feedId: feed!.id })

		const byStorage = await listUsage(ctx, "storage")
		expect(byStorage.rows[0]).toEqual({
			id: heavy.id,
			name: expect.any(String),
			email: heavy.email,
			saves: 12,
			editions: 0,
			refused: 0,
			storageBytes: 900 * MB,
			feeds: 0,
		})
		expect(byStorage.limits).toEqual(defaultLimits())
		expect(byStorage.month).toBe(month)

		const byRefusals = await listUsage(ctx, "refused")
		expect(byRefusals.rows[0]).toMatchObject({ id: noisy.id, refused: 1000, saves: 300, feeds: 1 })
	})
})
