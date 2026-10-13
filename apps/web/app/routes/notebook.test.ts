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
import { notebookHref } from "~/lib/notebook-filters"
import { loader } from "./notebook"

const session = vi.hoisted(() => ({ user: { id: "", name: "Reader", locale: "en" } }))
vi.mock("~/lib/session.server", () => ({ requireUser: () => session.user }))
// Topics need their models: the fake ones, which answer without calling anyone.
vi.hoisted(() => {
	process.env.AI_FAKE = "1"
})

const readerId = `test-notebook-route-${newId()}`
/** The same library, without the topics feature. */
const withoutId = `${readerId}-without`
const ids: Record<string, string> = {}

async function library(owner: string) {
	let minute = 0
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
				// A minute apart, in order: Craft one, Craft two, Loose one.
				createdAt: new Date(Date.UTC(2026, 8, 1, 0, ++minute)),
			})
		if (title === "Workshop")
			await db
				.update(documents)
				// Written between Craft two and Loose one.
				.set({ note: "Workshop thoughts", noteUpdatedAt: new Date(Date.UTC(2026, 8, 1, 0, 2, 30)) })
				.where(eq(documents.id, doc!.id))
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

type Card = { kind: "highlight"; exact: string } | { kind: "note"; note: string }
const card = (c: Card) => (c.kind === "highlight" ? c.exact : `note: ${c.note}`)
/** What the page shows: quotes, and article notes as `note: …`. */
const quotes = (data: Awaited<ReturnType<typeof page>>) => {
	const b = data.board
	if (b.kind === "topics") return b.groups.map((g) => [g.name, g.items.map(card)])
	if (b.kind === "articles")
		return b.articles.map((a) => [a.note, a.highlights.map((h) => h.exact)])
	return b.items.map(card).sort()
}

describe("the notebook", () => {
	it("by topic, while the reader's topics are in use; remembered like the other views", async () => {
		const data = await page(readerId, "/notebook?view=topics")
		expect(data.view).toBe("topics")
		expect(data.topicsOn).toBe(true)
		expect(quotes(data)).toEqual([
			["Craft", ["note: Workshop thoughts", "Craft two", "Craft one"]],
			[null, ["Loose one"]],
		])
		expect(data.setCookie).toMatch(/^klip_hl_view=topics;/)
		// The notes' links are looked up.
		expect(Object.values(data.linkTargets)).toEqual(["ok"])
	})

	it("without topics in use: by article, and a topics cookie is not taken", async () => {
		const asked = await page(withoutId, "/notebook?view=topics")
		expect(asked.view).toBe("articles")
		expect(asked.topicsOn).toBe(false)
		expect(asked.setCookie).toBeNull()
		const saved = await page(withoutId, "/notebook", "klip_hl_view=topics")
		expect(saved.view).toBe("articles")
	})

	it("narrows to the reader's own tag and topic only", async () => {
		const tagged = await page(readerId, `/notebook?view=stream&tag=${ids[`${readerId}:tag`]}`)
		expect(tagged.tag).toBe(ids[`${readerId}:tag`])
		expect(quotes(tagged)).toEqual(["Craft one", "Craft two", "note: Workshop thoughts"])
		expect(tagged.tags).toEqual([{ id: ids[`${readerId}:tag`], name: "keep", count: 3 }])
		// Another reader's tag, or a word: every highlight.
		for (const tag of [ids[`${withoutId}:tag`], "nonsense"]) {
			const data = await page(readerId, `/notebook?view=stream&tag=${tag}`)
			expect(data.tag).toBeNull()
			expect(quotes(data)).toHaveLength(4)
		}

		const topic = await page(readerId, `/notebook?view=stream&topic=${ids[`${readerId}:topic`]}`)
		expect([topic.topic, topic.topicName]).toEqual([ids[`${readerId}:topic`], "Craft"])
		expect(quotes(topic)).toEqual(["Craft one", "Craft two", "note: Workshop thoughts"])
		const none = await page(readerId, "/notebook?view=stream&topic=none")
		expect(quotes(none)).toEqual(["Loose one"])
		for (const [id, asked] of [
			[readerId, ids[`${withoutId}:topic`]],
			[readerId, "nonsense"],
			// Topics not in use: a topic narrows nothing.
			[withoutId, ids[`${withoutId}:topic`]],
		] as const) {
			const data = await page(id, `/notebook?view=stream&topic=${asked}`)
			expect(data.topic).toBeNull()
			expect(quotes(data)).toHaveLength(4)
		}
	})

	it("Shuffle: a new hand is a seed in the address, which deals the same hand again", async () => {
		session.user.id = readerId
		const thrown = await loader({
			request: new Request("http://localhost/notebook?show=notes&shuffle=new"),
			context: {},
			params: {},
		} as never).catch((e: unknown) => e)
		expect(thrown).toBeInstanceOf(Response)
		const to = (thrown as Response).headers.get("location")!
		expect(to).toMatch(/^\/notebook\?show=notes&shuffle=[a-z0-9]{1,16}$/)
		const dealt = await page(readerId, to)
		expect(dealt.board.kind).toBe("shuffle")
		expect(quotes(dealt)).toEqual(["Craft two", "note: Workshop thoughts"])
		expect(dealt.seed).toBe(new URL(to, "http://localhost").searchParams.get("shuffle"))
		// A seed this page never writes is no hand: the view.
		const odd = await page(readerId, "/notebook?view=stream&shuffle=NOT-A-SEED")
		expect(odd.board.kind).toBe("stream")
	})
})

describe("the notebook, continued", () => {
	it("a topic group's See all is a look, not a choice: the view remembered stays", async () => {
		const seeAll = await page(
			readerId,
			`/notebook?view=stream&topic=${ids[`${readerId}:topic`]}`,
			"klip_hl_view=topics",
		)
		expect(seeAll.setCookie).toBeNull()
		expect(seeAll.savedView).toBe("topics")
		expect(seeAll.board.kind).toBe("stream")
	})

	it("a tag of the reader's with no highlights left stays chosen, and shows none", async () => {
		const data = await page(readerId, `/notebook?view=stream&tag=${ids.emptied}`)
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
			// The article's note, written between the second and the third highlight.
			await db
				.update(documents)
				.set({ note: "Halfway", noteUpdatedAt: new Date(Date.UTC(2026, 8, 1, 0, 1, 30)) })
				.where(eq(documents.id, doc!.id))
			const first = await page(pagerId, `/notebook?view=stream&tag=${tag!.id}`)
			if (first.board.kind !== "stream") throw new Error("not the stream")
			expect(first.board.items).toHaveLength(50)
			expect(card(first.board.items[0] as Card)).toBe("Quote 52")
			const next = notebookHref(first, { cursor: first.board.nextCursor! })
			expect(next).toContain(`tag=${tag!.id}`)
			const second = await page(pagerId, next)
			if (second.board.kind !== "stream") throw new Error("not the stream")
			expect(second.board.items.map((c) => card(c as Card))).toEqual([
				"Quote 2",
				"note: Halfway",
				"Quote 1",
				"Quote 0",
			])
			expect(second.board.nextCursor).toBeNull()
			// A cursor the page never wrote: the first page.
			const bogus = await page(pagerId, "/notebook?view=stream&cursor=bogus")
			if (bogus.board.kind !== "stream") throw new Error("not the stream")
			expect(card(bogus.board.items[0] as Card)).toBe("Quote 52")
		} finally {
			await db.delete(user).where(eq(user.id, pagerId))
		}
	})
})

describe("by article, the page's first view", () => {
	it("opens by article: each article with its note and highlights, by latest activity", async () => {
		const data = await page(readerId, "/notebook")
		expect(data.view).toBe("articles")
		expect(data.setCookie).toBeNull()
		if (data.board.kind !== "articles") throw new Error("not by article")
		// Loose's highlight came after Workshop's note.
		expect(quotes(data)).toEqual([
			[null, ["Loose one"]],
			["Workshop thoughts", ["Craft one", "Craft two"]],
		])
		// What a save in place replaces, to the millisecond.
		expect(data.board.articles[1]!.noteUpdatedAt).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/)
		expect(data.board.nextCursor).toBeNull()
		expect(data.counts).toMatchObject({ all: 4, notes: 2, highlights: 3 })
	})

	it("Highlights leaves the article notes out of the cards; a tag of NULs narrows nothing", async () => {
		const marked = await page(readerId, "/notebook?view=stream&show=highlights")
		expect(marked.filter).toBe("highlights")
		expect(quotes(marked)).toEqual(["Craft one", "Craft two", "Loose one"])
		// Postgres text cannot hold one: sent on, it would fail the query.
		const nul = await page(readerId, "/notebook?view=stream&tag=%00")
		expect(nul.tag).toBeNull()
		expect(quotes(nul)).toHaveLength(4)
	})

	it("pages by article with the cursor it writes", async () => {
		const first = await page(readerId, "/notebook?view=articles")
		if (first.board.kind !== "articles") throw new Error("not by article")
		expect(first.board.articles).toHaveLength(2)
		const pagerId = `${readerId}-articles`
		await db.insert(user).values({ id: pagerId, name: "Pager", email: `${pagerId}@example.com` })
		try {
			// More noted articles than a page holds, a minute apart: the newest last.
			await db.insert(documents).values(
				Array.from({ length: 23 }, (_, i) => ({
					userId: pagerId,
					sourceUrl: `https://example.com/${pagerId}/${i}`,
					urlHash: `${pagerId}-${i}`,
					status: "ready" as const,
					title: `Article ${i}`,
					note: `Thought ${i}`,
					noteUpdatedAt: new Date(Date.UTC(2026, 8, 1, 0, i)),
				})),
			)
			const one = await page(pagerId, "/notebook")
			if (one.board.kind !== "articles") throw new Error("not by article")
			expect(one.board.articles).toHaveLength(20)
			expect(one.board.articles[0]!.documentTitle).toBe("Article 22")
			const two = await page(pagerId, notebookHref(one, { cursor: one.board.nextCursor! }))
			if (two.board.kind !== "articles") throw new Error("not by article")
			expect(two.board.articles.map((a) => a.documentTitle)).toEqual([
				"Article 2",
				"Article 1",
				"Article 0",
			])
			expect(two.board.nextCursor).toBeNull()
		} finally {
			await db.delete(user).where(eq(user.id, pagerId))
		}
	})
})
