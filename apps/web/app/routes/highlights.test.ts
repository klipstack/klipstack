import { createHash } from "node:crypto"
import {
	db,
	documents,
	documentTags,
	documentTopics,
	documentVersions,
	eq,
	highlights,
	newId,
	tags,
	topicLibraries,
	topicSorts,
	topics,
	user,
	userFeatures,
} from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { highlightsHref } from "~/lib/highlight-filters"
import { loader } from "./highlights"

const session = vi.hoisted(() => ({ user: { id: "", name: "Reader", locale: "en" } }))
vi.mock("~/lib/session.server", () => ({ requireUser: () => session.user }))
// Topics need their models: the fake ones, which answer without calling anyone.
vi.hoisted(() => {
	process.env.AI_FAKE = "1"
})

const readerId = `test-highlights-route-${newId()}`
/** The same library, without the topics feature. */
const withoutId = `${readerId}-without`
const ids: Record<string, string> = {}

async function library(owner: string) {
	await db
		.insert(topicLibraries)
		.values({ userId: owner, proposedAt: new Date(), confirmedAt: new Date() })
	const [topic] = await db
		.insert(topics)
		.values({ userId: owner, name: "Craft", description: "x", status: "active", origin: "first" })
		.returning({ id: topics.id })
	ids[`${owner}:topic`] = topic!.id
	const [tag] = await db
		.insert(tags)
		.values({ userId: owner, name: "keep" })
		.returning({ id: tags.id })
	ids[`${owner}:tag`] = tag!.id
	for (const [title, inTopic, tagged, quotes] of [
		["Workshop", true, true, ["Craft one", "Craft two"]],
		["Loose", false, false, ["Loose one"]],
	] as const) {
		const [doc] = await db
			.insert(documents)
			.values({
				userId: owner,
				sourceUrl: `https://example.com/${title}`,
				urlHash: newId(),
				title,
				status: "ready",
			})
			.returning({ id: documents.id })
		const [version] = await db
			.insert(documentVersions)
			.values({
				documentId: doc!.id,
				version: 1,
				html: "<p>x</p>",
				text: "x",
				textHash: createHash("sha256").update(newId()).digest("hex"),
				extractor: "test",
				extractorVersion: "0",
			})
			.returning({ id: documentVersions.id })
		await db.insert(topicSorts).values({ documentId: doc!.id, userId: owner })
		if (inTopic)
			await db
				.insert(documentTopics)
				.values({ documentId: doc!.id, topicId: topic!.id, probability: 0.9, level: "applied" })
		if (tagged) await db.insert(documentTags).values({ documentId: doc!.id, tagId: tag!.id })
		for (const exact of quotes)
			await db.insert(highlights).values({
				userId: owner,
				documentId: doc!.id,
				versionId: version!.id,
				startOffset: 0,
				endOffset: 1,
				exact,
				note: exact === "Craft two" ? `See [Loose](/read/${doc!.id})` : null,
			})
	}
}

beforeAll(async () => {
	await db
		.insert(user)
		.values([readerId, withoutId].map((id) => ({ id, name: "Reader", email: `${id}@example.com` })))
	await db.insert(userFeatures).values({ userId: readerId, feature: "topics" })
	await library(readerId)
	await library(withoutId)
	// A tag of the reader's whose articles have no highlights (any more).
	const [emptied] = await db
		.insert(tags)
		.values({ userId: readerId, name: "emptied" })
		.returning({ id: tags.id })
	ids.emptied = emptied!.id
})
afterAll(async () => {
	for (const id of [readerId, withoutId]) await db.delete(user).where(eq(user.id, id))
})

async function page(id: string, path: string, cookie?: string) {
	session.user.id = id
	const result = (await loader({
		request: new Request(`http://localhost${path}`, cookie ? { headers: { cookie } } : {}),
		context: {},
		params: {},
	} as never)) as unknown as {
		data: Awaited<ReturnType<typeof loader>>["data"]
		init: { headers?: Record<string, string> } | null
	}
	return { ...result.data, setCookie: result.init?.headers?.["Set-Cookie"] ?? null }
}

const quotes = (data: Awaited<ReturnType<typeof page>>) => {
	const b = data.board
	if (b.kind === "topics") return b.groups.map((g) => [g.name, g.highlights.map((h) => h.exact)])
	if (b.kind === "articles") return b.articles.map((a) => a.highlights.map((h) => h.exact))
	return b.items.map((h) => h.exact).sort()
}

describe("the highlights page", () => {
	it("by topic, while the reader's topics are in use; remembered like the other views", async () => {
		const data = await page(readerId, "/highlights?view=topics")
		expect(data.view).toBe("topics")
		expect(data.topicsOn).toBe(true)
		expect(quotes(data)).toEqual([
			["Craft", ["Craft two", "Craft one"]],
			[null, ["Loose one"]],
		])
		expect(data.setCookie).toMatch(/^klip_hl_view=topics;/)
		// The notes' links are looked up.
		expect(Object.values(data.linkTargets)).toEqual(["ok"])
	})

	it("without topics in use: by article, and a topics cookie is not taken", async () => {
		const asked = await page(withoutId, "/highlights?view=topics")
		expect(asked.view).toBe("articles")
		expect(asked.topicsOn).toBe(false)
		expect(asked.setCookie).toBeNull()
		const saved = await page(withoutId, "/highlights", "klip_hl_view=topics")
		expect(saved.view).toBe("articles")
	})

	it("narrows to the reader's own tag and topic only", async () => {
		const tagged = await page(readerId, `/highlights?view=stream&tag=${ids[`${readerId}:tag`]}`)
		expect(tagged.tag).toBe(ids[`${readerId}:tag`])
		expect(quotes(tagged)).toEqual(["Craft one", "Craft two"])
		expect(tagged.tags).toEqual([{ id: ids[`${readerId}:tag`], name: "keep", count: 2 }])
		// Another reader's tag, or a word: every highlight.
		for (const tag of [ids[`${withoutId}:tag`], "nonsense"]) {
			const data = await page(readerId, `/highlights?view=stream&tag=${tag}`)
			expect(data.tag).toBeNull()
			expect(quotes(data)).toHaveLength(3)
		}

		const topic = await page(readerId, `/highlights?view=stream&topic=${ids[`${readerId}:topic`]}`)
		expect([topic.topic, topic.topicName]).toEqual([ids[`${readerId}:topic`], "Craft"])
		expect(quotes(topic)).toEqual(["Craft one", "Craft two"])
		const none = await page(readerId, "/highlights?view=stream&topic=none")
		expect(quotes(none)).toEqual(["Loose one"])
		for (const [id, asked] of [
			[readerId, ids[`${withoutId}:topic`]],
			[readerId, "nonsense"],
			// Topics not in use: a topic narrows nothing.
			[withoutId, ids[`${withoutId}:topic`]],
		] as const) {
			const data = await page(id, `/highlights?view=stream&topic=${asked}`)
			expect(data.topic).toBeNull()
			expect(quotes(data)).toHaveLength(3)
		}
	})

	it("Shuffle: a new hand is a seed in the address, which deals the same hand again", async () => {
		session.user.id = readerId
		const thrown = await loader({
			request: new Request("http://localhost/highlights?show=notes&shuffle=new"),
			context: {},
			params: {},
		} as never).catch((e: unknown) => e)
		expect(thrown).toBeInstanceOf(Response)
		const to = (thrown as Response).headers.get("location")!
		expect(to).toMatch(/^\/highlights\?show=notes&shuffle=[a-z0-9]{1,16}$/)
		const dealt = await page(readerId, to)
		expect(dealt.board.kind).toBe("shuffle")
		expect(quotes(dealt)).toEqual(["Craft two"])
		expect(dealt.seed).toBe(new URL(to, "http://localhost").searchParams.get("shuffle"))
		// A seed this page never writes is no hand: the view.
		const odd = await page(readerId, "/highlights?view=stream&shuffle=NOT-A-SEED")
		expect(odd.board.kind).toBe("stream")
	})
})

describe("the highlights page, continued", () => {
	it("a topic group's See all is a look, not a choice: the view remembered stays", async () => {
		const seeAll = await page(
			readerId,
			`/highlights?view=stream&topic=${ids[`${readerId}:topic`]}`,
			"klip_hl_view=topics",
		)
		expect(seeAll.setCookie).toBeNull()
		expect(seeAll.savedView).toBe("topics")
		expect(seeAll.board.kind).toBe("stream")
	})

	it("a tag of the reader's with no highlights left stays chosen, and shows none", async () => {
		const data = await page(readerId, `/highlights?view=stream&tag=${ids.emptied}`)
		expect(data.tag).toBe(ids.emptied)
		expect(quotes(data)).toEqual([])
		expect(data.tags).toContainEqual({ id: ids.emptied, name: "emptied", count: 0 })
	})

	it("pages the stream through its cursor, keeping the tag", async () => {
		const pagerId = `${readerId}-pager`
		await db.insert(user).values({ id: pagerId, name: "Pager", email: `${pagerId}@example.com` })
		try {
			const [doc] = await db
				.insert(documents)
				.values({
					userId: pagerId,
					sourceUrl: "https://example.com/p",
					urlHash: newId(),
					title: "P",
					status: "ready",
				})
				.returning({ id: documents.id })
			const [version] = await db
				.insert(documentVersions)
				.values({
					documentId: doc!.id,
					version: 1,
					html: "<p>x</p>",
					text: "x",
					textHash: createHash("sha256").update(newId()).digest("hex"),
					extractor: "test",
					extractorVersion: "0",
				})
				.returning({ id: documentVersions.id })
			const [tag] = await db
				.insert(tags)
				.values({ userId: pagerId, name: "p" })
				.returning({ id: tags.id })
			await db.insert(documentTags).values({ documentId: doc!.id, tagId: tag!.id })
			await db.insert(highlights).values(
				Array.from({ length: 53 }, (_, i) => ({
					userId: pagerId,
					documentId: doc!.id,
					versionId: version!.id,
					startOffset: 0,
					endOffset: 1,
					exact: `Quote ${i}`,
					createdAt: new Date(Date.UTC(2026, 8, 1, 0, i)),
				})),
			)
			const first = await page(pagerId, `/highlights?view=stream&tag=${tag!.id}`)
			if (first.board.kind !== "stream") throw new Error("not the stream")
			expect(first.board.items).toHaveLength(50)
			expect(first.board.items[0]!.exact).toBe("Quote 52")
			const next = highlightsHref(first, { cursor: first.board.nextCursor! })
			expect(next).toContain(`tag=${tag!.id}`)
			const second = await page(pagerId, next)
			expect(quotes(second)).toEqual(["Quote 0", "Quote 1", "Quote 2"])
			if (second.board.kind === "stream") expect(second.board.nextCursor).toBeNull()
		} finally {
			await db.delete(user).where(eq(user.id, pagerId))
		}
	})
})
