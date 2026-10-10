import {
	db,
	eq,
	feeds,
	inArray,
	storeFeedEntries,
	subscriptions,
	user as userTable,
} from "@klipstack/db"
import { parseOpml, urlHash } from "@klipstack/extract"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { env } from "~/lib/env.server"
import { exportOpml, importOpml, listFeedPage, OPML_IMPORT_MAX } from "./feeds.server"

// No fetch jobs: nothing here should reach a worker.
const enqueue = vi.hoisted(() => vi.fn(async () => null))
vi.mock("@klipstack/queue", async (original) => ({
	...(await original<typeof import("@klipstack/queue")>()),
	enqueue,
}))

const stamp = Date.now()
const userId = `test-opml-${stamp}`
const bulkId = `test-opml-bulk-${stamp}`
const cappedId = `test-opml-capped-${stamp}`
const host = `opml-test-${stamp}.example.com`
const knownUrl = `https://${host}/known/feed`
const newUrl = `https://${host}/new/feed`

const day = (n: number) => new Date(Date.UTC(2026, 8, n))

const outline = (url: string, title?: string) =>
	`<outline type="rss"${title ? ` text="${title}"` : ""} xmlUrl="${url}"/>`
const opml = (...outlines: string[]) =>
	`<?xml version="1.0"?><opml version="2.0"><head/><body>${outlines.join("")}</body></opml>`

beforeAll(async () => {
	await db.insert(userTable).values([
		{ id: userId, name: "Opml", email: `${userId}@example.com` },
		{ id: bulkId, name: "Bulk", email: `${bulkId}@example.com` },
		{ id: cappedId, name: "Capped", email: `${cappedId}@example.com` },
	])
	// A feed someone else follows already, with eight posts.
	const [known] = await db
		.insert(feeds)
		.values({ url: knownUrl, urlHash: urlHash(knownUrl), title: "Known blog" })
		.returning({ id: feeds.id })
	await storeFeedEntries(
		known!.id,
		[1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
			const url = `https://${host}/known/${n}`
			return {
				guid: `${n}`,
				url,
				urlHash: urlHash(url),
				title: `Post ${n}`,
				author: null,
				excerpt: null,
				publishedAt: day(n),
			}
		}),
		day(10),
	)
})

afterAll(async () => {
	await db.delete(userTable).where(inArray(userTable.id, [userId, bulkId, cappedId]))
	await db.execute(`delete from feeds where url like 'https://${host}/%'`)
})

describe("importOpml", () => {
	it("follows known and new feeds without fetching, and queues the new ones", async () => {
		const result = await importOpml(
			userId,
			opml(
				`<outline text="Folder">${outline(knownUrl, "Known blog")}</outline>`,
				outline(newUrl, "My new blog"),
				outline(`${newUrl}#again`, "Same feed"),
				outline("ftp://files.example.com/feed", "Not the web"),
				outline("not a url"),
			),
		)
		expect(result).toEqual({ added: 2, existing: 0, skipped: 2, overLimit: 0 })

		const created = await db.query.feeds.findFirst({ where: eq(feeds.urlHash, urlHash(newUrl)) })
		// The shared row takes nothing from the file but the address.
		expect(created).toMatchObject({ title: null, siteUrl: null, lastSuccessAt: null })
		expect(created!.nextFetchAt.getTime()).toBeGreaterThan(Date.now())
		expect(enqueue.mock.calls).toEqual([["feed-fetch", { feedId: created!.id }]])

		const { sections, quiet } = await listFeedPage(userId)
		// The known feed starts at its latest five; its name was the feed's own, so none is kept.
		expect(sections.map((s) => [s.title, s.items.length])).toEqual([["Known blog", 5]])
		// The new one goes by the file's name until its first fetch.
		expect(quiet.map((q) => q.title)).toEqual(["My new blog"])
		const subs = await db.query.subscriptions.findMany({ where: eq(subscriptions.userId, userId) })
		expect(subs.map((s) => s.title).sort()).toEqual(["My new blog", null])
	})

	it("counts what the user follows already", async () => {
		enqueue.mockClear()
		const result = await importOpml(userId, opml(outline(knownUrl), outline(newUrl)))
		expect(result).toEqual({ added: 0, existing: 2, skipped: 0, overLimit: 0 })
		expect(enqueue).not.toHaveBeenCalled()
	})

	it("stops at the limit", async () => {
		const before = env.LIMIT_FEEDS
		env.LIMIT_FEEDS = OPML_IMPORT_MAX
		try {
			const outlines = Array.from({ length: OPML_IMPORT_MAX + 3 }, (_, i) =>
				outline(`https://${host}/bulk/${i}`),
			)
			const result = await importOpml(bulkId, opml(...outlines))
			expect(result).toEqual({ added: OPML_IMPORT_MAX, existing: 0, skipped: 3, overLimit: 0 })
		} finally {
			env.LIMIT_FEEDS = before
		}
	})

	it("follows new feeds up to the feed cap, in the file's order; followed ones take no room", async () => {
		const before = env.LIMIT_FEEDS
		env.LIMIT_FEEDS = 3
		enqueue.mockClear()
		try {
			await importOpml(cappedId, opml(outline(knownUrl)))
			const capped = [0, 1, 2, 3].map((i) => `https://${host}/capped/${i}`)
			const result = await importOpml(
				cappedId,
				opml(outline(knownUrl), ...capped.map((u) => outline(u))),
			)
			expect(result).toEqual({ added: 2, existing: 1, skipped: 0, overLimit: 2 })
			const followed = await db
				.select({ url: feeds.url })
				.from(subscriptions)
				.innerJoin(feeds, eq(feeds.id, subscriptions.feedId))
				.where(eq(subscriptions.userId, cappedId))
			expect(followed.map((f) => f.url).sort()).toEqual([knownUrl, capped[0], capped[1]].sort())
			// The ones left out are not stored, and nothing fetches them.
			expect(enqueue).toHaveBeenCalledTimes(2)
			const stored = await db.query.feeds.findMany({
				where: inArray(
					feeds.urlHash,
					capped.slice(2).map((u) => urlHash(u)),
				),
			})
			expect(stored).toEqual([])

			expect(await importOpml(cappedId, opml(outline(`https://${host}/capped/9`)))).toEqual({
				added: 0,
				existing: 0,
				skipped: 0,
				overLimit: 1,
			})
		} finally {
			env.LIMIT_FEEDS = before
		}
	})

	it("refuses other files", async () => {
		await expect(importOpml(userId, "<rss/>")).rejects.toMatchObject({ code: "not_opml" })
		await expect(importOpml(userId, "")).rejects.toMatchObject({ code: "not_opml" })
		await expect(importOpml(userId, opml())).rejects.toMatchObject({ code: "no_feeds" })
	})
})

describe("exportOpml", () => {
	it("lists the user's feeds by title, under their own names", async () => {
		expect(parseOpml(await exportOpml(userId))).toEqual([
			{ xmlUrl: knownUrl, title: "Known blog", htmlUrl: null },
			{ xmlUrl: newUrl, title: "My new blog", htmlUrl: null },
		])
	})

	it("is an empty list for someone who follows nothing", async () => {
		expect(parseOpml(await exportOpml(`nobody-${stamp}`))).toEqual([])
	})
})
