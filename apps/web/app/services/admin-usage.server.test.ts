import { randomUUID } from "node:crypto"
import {
	assets,
	db,
	documents,
	documentVersions,
	feeds,
	highlights,
	inArray,
	subscriptions,
	usageCounts,
} from "@klipstack/db"
import { afterAll, describe, expect, it } from "vitest"
import { authorizeAdmin } from "~/lib/admin.server"
import { env } from "~/lib/env.server"
import { countRefusal, defaultLimits, monthOf } from "~/lib/limits.server"
import { findStarterText, starterUrlHash } from "~/lib/starter-texts.server"
import { adminFixtures } from "~/test/admin-fixtures"
import { listStarterUsage, listTopicUsage, listUsage } from "./admin-usage.server"

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
			topicCostUsd: 0,
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

describe("listUsage, topics", () => {
	it("ranks by what topics cost, apart from AI questions, with the month's total", async () => {
		const ctx = await authorizeAdmin(await (await fx.account({ role: "admin" })).session())
		const sorter = await fx.account()
		const { month } = monthOf()
		const before = (await listUsage(ctx, "topicCost")).topicCostUsd
		// Far past any test account's real spend, so this one leads the ranking.
		await db.insert(usageCounts).values([
			{ userId: sorter.id, metric: "topic_spend", month, count: 2_000_000_000 },
			{ userId: sorter.id, metric: "topic_spend", month: "2000-01-01", count: 7_000_000 },
			{ userId: sorter.id, metric: "ai_spend", month, count: 10_000 },
		])

		const usage = await listUsage(ctx, "topicCost")
		// Most expensive first; other test accounts may be listed too.
		const costs = usage.rows.map((r) => r.topicCostUsd)
		expect(costs).toEqual([...costs].sort((a, b) => b - a))
		expect(usage.rows.find((r) => r.id === sorter.id)).toMatchObject({
			aiCostUsd: 0.01,
			topicCostUsd: 2000,
		})
		expect(usage.topicCostUsd).toBeGreaterThanOrEqual(before + 2000 - 1e-6)
	})
})

describe("listTopicUsage", () => {
	it("lists the accounts that used topics this month, most expensive first, against the caps", async () => {
		const ctx = await authorizeAdmin(await (await fx.account({ role: "admin" })).session())
		const big = await fx.account()
		const small = await fx.account()
		const idle = await fx.account()
		const { month } = monthOf()
		await db.insert(usageCounts).values([
			{ userId: big.id, metric: "topic_spend", month, count: 1_900_000_000 },
			{ userId: big.id, metric: "topic_sorts", month, count: 1000 },
			{ userId: big.id, metric: "topics", month, count: 7 },
			{ userId: small.id, metric: "topic_spend", month, count: 1_800_000_000 },
			{ userId: small.id, metric: "topic_sorts", month, count: 3 },
			{ userId: small.id, metric: "topic_opened", month, count: 4 },
			{ userId: small.id, metric: "topic_renamed", month, count: 2 },
			{ userId: small.id, metric: "topic_opened", month: "2000-01-01", count: 40 },
			// Only last month, or only questions: not this month's topics.
			{ userId: idle.id, metric: "topic_sorts", month: "2000-01-01", count: 50 },
			{ userId: idle.id, metric: "ai_spend", month, count: 2_100_000_000 },
		])

		const { rows, limits } = await listTopicUsage(ctx)
		expect(limits).toEqual({ topics: 100, sorts: 1000 })
		const ours = rows.filter((r) => [big.id, small.id, idle.id].includes(r.id))
		expect(ours).toEqual([
			{
				id: big.id,
				name: expect.any(String),
				email: big.email,
				sorts: 1000,
				work: 7,
				costUsd: 1900,
				uses: {
					topic_filter_library: 0,
					topic_filter_search: 0,
					topic_opened: 0,
					topic_next: 0,
					topic_home: 0,
					topic_taken_out: 0,
					topic_renamed: 0,
					topic_removed: 0,
				},
			},
			{
				id: small.id,
				name: expect.any(String),
				email: small.email,
				sorts: 3,
				work: 0,
				costUsd: 1800,
				uses: {
					topic_filter_library: 0,
					topic_filter_search: 0,
					topic_opened: 4,
					topic_next: 0,
					topic_home: 0,
					topic_taken_out: 0,
					topic_renamed: 2,
					topic_removed: 0,
				},
			},
		])
	})
})

describe("listStarterUsage", () => {
	/** A copy of a starter text in a library, as saving it leaves it, with `values` over that. */
	async function copy(
		userId: string,
		slug: string,
		values: Partial<typeof documents.$inferInsert> = {},
	) {
		const text = findStarterText(slug)!
		const [doc] = await db
			.insert(documents)
			.values({
				userId,
				sourceUrl: text.url,
				urlHash: starterUrlHash(text),
				status: "ready",
				...values,
			})
			.returning({ id: documents.id })
		return doc!.id
	}

	async function highlight(
		userId: string,
		documentId: string,
		note: string | null,
		deletedAt: Date | null = null,
	) {
		const [version] = await db
			.insert(documentVersions)
			.values({
				documentId,
				version: 1,
				html: "<p>Text</p>",
				text: "Text",
				textHash: randomUUID(),
				extractor: "test",
				extractorVersion: "0",
			})
			.returning({ id: documentVersions.id })
		await db.insert(highlights).values({
			userId,
			documentId,
			versionId: version!.id,
			startOffset: 0,
			endOffset: 4,
			exact: "Text",
			note,
			deletedAt,
		})
	}

	it("counts, per text, the libraries that have it and what their readers did with it", async () => {
		const ctx = await authorizeAdmin(await (await fx.account({ role: "admin" })).session())
		// Other tests' libraries may hold starter texts too: what this one adds is the difference.
		const before = await listStarterUsage(ctx)
		const [a, b, c, d, e] = await Promise.all([
			fx.account(),
			fx.account(),
			fx.account(),
			fx.account(),
			fx.account(),
		])
		await copy(a.id, "bacon-of-studies", { readAt: new Date() })
		await highlight(b.id, await copy(b.id, "bacon-of-studies"), null)
		await highlight(c.id, await copy(c.id, "bacon-of-studies"), "Mine.")
		await copy(d.id, "bacon-of-studies", { note: "On the whole essay." })
		// A deleted highlight, and its note, no longer count.
		await highlight(e.id, await copy(e.id, "bacon-of-studies"), "Gone.", new Date())
		// Not counted: another text, and a copy in the trash.
		await copy(a.id, "guide-es")
		await copy(b.id, "seneca-on-reading", { deletedAt: new Date(), readAt: new Date() })

		const after = await listStarterUsage(ctx)
		const diff = (slug: string) => {
			const was = before.find((row) => row.slug === slug)!
			const now = after.find((row) => row.slug === slug)!
			return {
				saved: now.saved - was.saved,
				finished: now.finished - was.finished,
				highlighted: now.highlighted - was.highlighted,
				noted: now.noted - was.noted,
			}
		}
		expect(diff("bacon-of-studies")).toEqual({ saved: 5, finished: 1, highlighted: 2, noted: 2 })
		expect(diff("guide-es")).toEqual({ saved: 1, finished: 0, highlighted: 0, noted: 0 })
		expect(diff("seneca-on-reading")).toEqual({ saved: 0, finished: 0, highlighted: 0, noted: 0 })
		expect(after.find((row) => row.slug === "bacon-of-studies")).toMatchObject({
			title: "Of Studies",
			language: "en",
		})
	})
})
