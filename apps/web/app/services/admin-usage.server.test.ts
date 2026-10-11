import { randomUUID } from "node:crypto"
import {
	aiBriefs,
	aiMessages,
	aiThreads,
	assets,
	db,
	documents,
	documentVersions,
	feeds,
	inArray,
	subscriptions,
	usageCounts,
} from "@klipstack/db"
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
	it("ranks by AI questions, with each account's own cap and this month's estimated cost", async () => {
		const admin = await fx.account({ role: "admin" })
		const ctx = await authorizeAdmin(await admin.session())
		const asker = await fx.account()
		const { month } = monthOf()
		// Far past any test account's real usage, so these two lead the ranking.
		await db.insert(usageCounts).values([
			{ userId: asker.id, metric: "ai", month, count: 100_001 },
			{ userId: admin.id, metric: "ai", month, count: 100_000 },
		])
		const [doc] = await db
			.insert(documents)
			.values({
				userId: asker.id,
				sourceUrl: `https://example.com/usage/${randomUUID()}`,
				urlHash: randomUUID(),
				status: "ready",
				title: "Costs",
			})
			.returning({ id: documents.id })
		const [version] = await db
			.insert(documentVersions)
			.values({
				documentId: doc!.id,
				version: 1,
				html: "<p>Text</p>",
				text: "Text",
				textHash: randomUUID(),
				extractor: "test",
				extractorVersion: "0",
			})
			.returning({ id: documentVersions.id })
		const [thread] = await db
			.insert(aiThreads)
			.values({
				documentId: doc!.id,
				userId: asker.id,
				versionId: version!.id,
				startOffset: 0,
				endOffset: 4,
				exact: "Text",
				action: "explain",
			})
			.returning({ id: aiThreads.id })
		const haiku = "anthropic:claude-haiku-5-5"
		await db.insert(aiMessages).values([
			{ threadId: thread!.id, role: "user", text: "What?" },
			// $0.002 in, $0.0005 out.
			{
				threadId: thread!.id,
				role: "assistant",
				text: "A",
				model: haiku,
				inputTokens: 20_000,
				outputTokens: 1000,
				cacheReadTokens: 0,
			},
			// A follow-up read from the cache: $0.0002 + $0.00018 in, $0.00025 out.
			{
				threadId: thread!.id,
				role: "assistant",
				text: "B",
				model: haiku,
				inputTokens: 20_000,
				outputTokens: 500,
				cacheReadTokens: 18_000,
			},
			// Last month's answer is not this month's cost.
			{
				threadId: thread!.id,
				role: "assistant",
				text: "C",
				model: haiku,
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
				cacheReadTokens: 0,
				createdAt: new Date("2000-01-15T00:00:00Z"),
			},
		])
		// $0.001 in, $0.0002 out.
		await db.insert(aiBriefs).values({
			documentId: doc!.id,
			userId: asker.id,
			versionId: version!.id,
			text: "Brief",
			model: haiku,
			inputTokens: 10_000,
			outputTokens: 400,
			cacheReadTokens: 0,
		})

		const { rows } = await listUsage(ctx, "ai")
		expect(rows[0]).toMatchObject({ id: asker.id, ai: 100_001, aiMax: env.LIMIT_AI_PER_MONTH })
		expect(rows[0]!.aiCostUsd).toBeCloseTo(0.0025 + 0.00063 + 0.0012, 10)
		expect(rows[1]).toMatchObject({
			id: admin.id,
			ai: 100_000,
			aiMax: env.LIMIT_AI_PER_MONTH_ADMIN,
			aiCostUsd: 0,
		})
	})
})
