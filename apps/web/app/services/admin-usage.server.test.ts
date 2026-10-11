import { randomUUID } from "node:crypto"
import { assets, db, feeds, inArray, subscriptions, usageCounts } from "@klipstack/db"
import { afterAll, describe, expect, it } from "vitest"
import { authorizeAdmin } from "~/lib/admin.server"
import { env } from "~/lib/env.server"
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
			ai: 0,
			aiMax: env.LIMIT_AI_PER_MONTH,
			aiCostUsd: 0,
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

describe("listUsage, AI", () => {
	it("ranks by AI questions, with each account's own cap, its cost and the month's total", async () => {
		const admin = await fx.account({ role: "admin" })
		const ctx = await authorizeAdmin(await admin.session())
		const asker = await fx.account()
		const { month } = monthOf()
		const before = (await listUsage(ctx, "ai")).aiCostUsd
		// Far past any test account's real usage, so these two lead the ranking.
		await db.insert(usageCounts).values([
			{ userId: asker.id, metric: "ai", month, count: 100_001 },
			{ userId: admin.id, metric: "ai", month, count: 100_000 },
			// $4.33 this month, in millionths of a dollar; last month's is not this month's.
			{ userId: asker.id, metric: "ai_spend", month, count: 4_330_000 },
			{ userId: asker.id, metric: "ai_spend", month: "2000-01-01", count: 9_000_000 },
		])

		const usage = await listUsage(ctx, "ai")
		expect(usage.rows[0]).toMatchObject({
			id: asker.id,
			ai: 100_001,
			aiMax: env.LIMIT_AI_PER_MONTH,
			aiCostUsd: 4.33,
		})
		expect(usage.rows[1]).toMatchObject({
			id: admin.id,
			ai: 100_000,
			aiMax: env.LIMIT_AI_PER_MONTH_ADMIN,
			aiCostUsd: 0,
		})
		// Every account's: other tests may add to it meanwhile, never take from it.
		expect(usage.aiCostUsd).toBeGreaterThanOrEqual(before + 4.33 - 1e-9)
	})
})
