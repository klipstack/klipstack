import { createHash, randomUUID } from "node:crypto"
import { HTML_MAX_BYTES, URL_MAX } from "@klipstack/api-contract"
import {
	assets,
	db,
	documents,
	eq,
	feedItems,
	feeds,
	sql,
	subscriptions,
	user as userTable,
} from "@klipstack/db"
import { stopBoss } from "@klipstack/queue"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { env } from "~/lib/env.server"
import { monthOf, usageOf } from "~/lib/limits.server"
import { rateLimit, SAVE_LIMIT } from "~/lib/rate-limit.server"
import { purgeArticles, trashArticles } from "./articles.server"
import { saveArticle, saveFeedItems } from "./saving.server"

const stamp = Date.now()
const users: string[] = []
const hash = (s: string) => createHash("sha256").update(s).digest("hex")
let feedId: string

/** A user of their own: the save limit is per user and lives in memory. */
async function newUser() {
	const id = `test-saving-${stamp}-${users.length}`
	await db.insert(userTable).values({ id, name: "Saver", email: `${id}@example.com` })
	users.push(id)
	return id
}

/** Uses up all but `left` of the user's saves. */
function spend(userId: string, left = 0) {
	for (let i = 0; i < SAVE_LIMIT.limit - left; i++)
		rateLimit(`save:${userId}`, SAVE_LIMIT.limit, SAVE_LIMIT.windowMs)
}

const url = (name: string) => `https://example.com/saving-${stamp}/${name}`

beforeAll(async () => {
	const feedUrl = `https://example.com/saving-${stamp}/feed.xml`
	const [feed] = await db
		.insert(feeds)
		.values({ url: feedUrl, urlHash: hash(feedUrl), title: "Saving blog" })
		.returning({ id: feeds.id })
	feedId = feed!.id
})

afterAll(async () => {
	// Saving admits real extraction jobs; no worker runs here to take them.
	for (const id of users)
		await db.execute(
			sql`delete from pgboss.job where data->>'documentId' in (select id::text from documents where user_id = ${id})`,
		)
	for (const id of users) await db.delete(userTable).where(eq(userTable.id, id))
	await db.delete(feeds).where(eq(feeds.id, feedId))
	await stopBoss()
})

describe("saveArticle", () => {
	it("saves once per URL, and answers with the article already there", async () => {
		const userId = await newUser()
		const first = await saveArticle(userId, { url: `  ${url("one")}  `, source: "web" })
		expect(first.created).toBe(true)
		const again = await saveArticle(userId, { url: url("one"), source: "api" })
		expect(again).toMatchObject({ created: false, article: { id: first.article.id, tags: [] } })
	})

	it("counts every save, from anywhere, against one limit; a refused URL costs nothing", async () => {
		const userId = await newUser()
		spend(userId, 1)
		await expect(saveArticle(userId, { url: "not a url", source: "web" })).rejects.toMatchObject({
			code: "invalid_url",
		})
		await expect(
			saveArticle(userId, { url: "https://www.youtube.com/watch?v=abc", source: "extension" }),
		).rejects.toMatchObject({ code: "unsupported_youtube", status: 422 })
		await saveArticle(userId, { url: url("last"), source: "extension" })
		const refused = await saveArticle(userId, { url: url("over"), source: "api" }).catch(
			(e: unknown) => e,
		)
		expect(refused).toMatchObject({ code: "rate_limited", status: 429 })
		expect((refused as { retryAfter: number }).retryAfter).toBeGreaterThan(0)
	})

	it("refuses what is past the limits before counting it", async () => {
		const userId = await newUser()
		spend(userId, 1)
		for (const input of [
			{ url: "", source: "web" as const },
			{ url: `https://example.com/${"a".repeat(URL_MAX)}`, source: "web" as const },
			{ url: url("big"), html: "é".repeat(HTML_MAX_BYTES / 2 + 1), source: "extension" as const },
		])
			await expect(saveArticle(userId, input)).rejects.toMatchObject({ code: "invalid_request" })
		// The one save left is still there.
		await saveArticle(userId, { url: url("fits"), source: "web" })
	})
})

describe("the caps", () => {
	const caps = { saves: env.LIMIT_SAVES_PER_MONTH, storage: env.LIMIT_STORAGE_MB }
	afterEach(() => {
		env.LIMIT_SAVES_PER_MONTH = caps.saves
		env.LIMIT_STORAGE_MB = caps.storage
	})

	it("counts new articles this month, from anywhere; deleting one does not give it back", async () => {
		const userId = await newUser()
		env.LIMIT_SAVES_PER_MONTH = 2
		const first = await saveArticle(userId, { url: url("cap-1"), source: "web" })
		await saveArticle(userId, { url: url("cap-2"), source: "api" })
		// Saving what the library has already is no new article.
		expect(await saveArticle(userId, { url: url("cap-1"), source: "extension" })).toMatchObject({
			created: false,
		})
		await trashArticles(userId, [first.article.id])
		await purgeArticles(userId, [first.article.id])

		const refused = await saveArticle(userId, { url: url("cap-3"), source: "web" }).catch(
			(e: unknown) => e,
		)
		expect(refused).toMatchObject({
			code: "limit_reached",
			status: 403,
			details: { limit: "saves", max: 2, resetsAt: monthOf().resetsAt.toISOString() },
		})
		expect((refused as Error).message).toMatch(/saved 2 articles this month/)
		const kept = await db.query.documents.findMany({ where: eq(documents.userId, userId) })
		expect(kept.map((d) => d.sourceUrl)).toEqual([url("cap-2")])
		expect((await usageOf(userId)).saves).toEqual({ used: 2, max: 2 })
		// The refusal did not use up the rate limit: one save in the hour is left.
		spend(userId, 4)
		env.LIMIT_SAVES_PER_MONTH = 3
		await saveArticle(userId, { url: url("cap-3"), source: "web" })
	})

	it("refuses a new article or capture once storage is full, and still answers a plain save", async () => {
		const userId = await newUser()
		const kept = await saveArticle(userId, { url: url("full-1"), source: "web" })
		env.LIMIT_STORAGE_MB = 1
		await db.insert(assets).values({
			userId,
			sha256: hash(`${userId}-image`),
			storageKey: `test/${userId}`,
			contentType: "image/webp",
			bytes: 1024 * 1024,
		})
		expect((await usageOf(userId)).storage.used).toBeGreaterThanOrEqual(1024 * 1024)
		for (const input of [
			{ url: url("full-2"), source: "web" as const },
			{ url: url("full-1"), html: "<p>Fresh</p>", source: "extension" as const },
		])
			await expect(saveArticle(userId, input)).rejects.toMatchObject({
				code: "limit_reached",
				details: { limit: "storage", max: 1024 * 1024 },
			})
		expect(await saveArticle(userId, { url: url("full-1"), source: "web" })).toMatchObject({
			created: false,
			article: { id: kept.article.id },
		})
	})

	it("stops saving feed posts at the cap", async () => {
		const userId = await newUser()
		await db.insert(subscriptions).values({ userId, feedId })
		const posts = await db
			.insert(feedItems)
			.values(
				["x", "y"].map((name) => ({
					feedId,
					guid: `${stamp}-${name}`,
					url: url(`post-${name}`),
					urlHash: hash(url(`post-${name}`)),
					title: `Post ${name}`,
				})),
			)
			.returning({ id: feedItems.id })
		const [x, y] = posts.map((p) => p.id) as [string, string]
		env.LIMIT_SAVES_PER_MONTH = 1
		await saveArticle(userId, { url: url("before-posts"), source: "web" })
		const result = await saveFeedItems(userId, [x, y])
		expect(result.saved).toEqual([])
		expect(result.notSaved.map((n) => [n.itemId, n.code])).toEqual([
			[x, "limit_reached"],
			[y, "limit_reached"],
		])
	})
})

describe("saveFeedItems", () => {
	it("saves the user's posts, reports the rest, and stops at the limit", async () => {
		const userId = await newUser()
		await db.insert(subscriptions).values({ userId, feedId })
		const posts = await db
			.insert(feedItems)
			.values(
				["a", "b", "c"].map((name) => ({
					feedId,
					guid: `${stamp}-${name}`,
					url: url(`post-${name}`),
					urlHash: hash(url(`post-${name}`)),
					title: `Post ${name}`,
				})),
			)
			.returning({ id: feedItems.id })
		const [a, b, c] = posts.map((p) => p.id) as [string, string, string]
		const missing = randomUUID()
		spend(userId, 1)
		// A post not in the feed costs no save; past the limit, the rest are not saved.
		const result = await saveFeedItems(userId, [missing, a, b, c])
		expect(result.notFound).toEqual([missing])
		expect(result.saved.map((s) => s.itemId)).toEqual([a])
		expect(result.notSaved.map((n) => [n.itemId, n.code])).toEqual([
			[b, "rate_limited"],
			[c, "rate_limited"],
		])
		expect(result.notSaved[0]?.message).toMatch(/Too many saves/)
	})
})
