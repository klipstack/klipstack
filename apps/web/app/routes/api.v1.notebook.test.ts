import { createHash } from "node:crypto"
import type { NotebookItem } from "@klipstack/api-contract"
import {
	assets,
	db,
	documents,
	documentTags,
	documentTopics,
	eq,
	highlightResurfacing,
	highlights,
	newId,
	tags,
	topicLibraries,
	topics,
	userFeatures,
} from "@klipstack/db"
import { stopBoss } from "@klipstack/queue"
import type { KlipstackApiError } from "@klipstack/sdk"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { env } from "~/lib/env.server"
import { apiUsers, request } from "~/test/api-harness"
import { insertArticle } from "../../e2e/seed"

// Topic models, as on a server with both keys: By topic needs them.
vi.hoisted(() => {
	process.env.AI_FAKE = "1"
})

/**
 * The Notebook, Home's daily highlights and the search of highlights and notes in /api/v1, through
 * the SDK as the iPhone app calls them, on the real database.
 */

const origin = new URL(env.APP_URL).origin
const MISSING = "00000000-0000-4000-8000-000000000000"
const users = apiUsers("api-notebook")
afterAll(async () => {
	await users.cleanup()
	await stopBoss()
})

const errorOf = (promise: Promise<unknown>) =>
	promise.then(
		() => {
			throw new Error("expected the call to fail")
		},
		(e: unknown) => e as KlipstackApiError,
	)

const md5 = (text: string) => createHash("md5").update(text).digest("hex")

const DAY_MS = 86_400_000
/** `days` days and `minutes` minutes before now. */
const ago = (days: number, minutes = 0) => new Date(Date.now() - days * DAY_MS - minutes * 60_000)
const utcDay = (offsetDays = 0) =>
	new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10)

async function article(
	owner: string,
	title: string,
	values: Partial<typeof documents.$inferInsert> = {},
) {
	const id = await insertArticle(owner, title, `<p>${title}</p>`)
	if (Object.keys(values).length) await db.update(documents).set(values).where(eq(documents.id, id))
	const [doc] = await db.select().from(documents).where(eq(documents.id, id))
	return doc!
}

async function highlight(
	doc: { id: string; userId: string; currentVersionId: string | null },
	exact: string,
	createdAt: Date,
	values: Partial<typeof highlights.$inferInsert> = {},
) {
	const [h] = await db
		.insert(highlights)
		.values({
			userId: doc.userId,
			documentId: doc.id,
			versionId: doc.currentVersionId!,
			startOffset: 0,
			endOffset: exact.length,
			exact,
			createdAt,
			...values,
		})
		.returning({ id: highlights.id })
	return h!.id
}

/**
 * The reader's notebook:
 *   Garden (stored cover; note "Prune the roses" written 1 day ago): "first passage" at offset 10,
 *     made 5 days ago, and "second passage" at offset 0 (green, a note "think about soil"), 4 days ago
 *   Kitchen (the site's own cover): "bread rises", made 2 days ago
 *   Attic: in the trash, with a highlight and a note. A deleted highlight on Garden.
 * Another reader has "first passage" too.
 */
describe("the Notebook in the API", () => {
	let me: Awaited<ReturnType<typeof users.create>>
	let other: Awaited<ReturnType<typeof users.create>>
	const id: Record<string, string> = {}
	let garden: typeof documents.$inferSelect

	beforeAll(async () => {
		me = await users.create("Notebook")
		other = await users.create("Other")
		const [asset] = await db
			.insert(assets)
			.values({
				userId: me.id,
				sha256: newId().replaceAll("-", ""),
				storageKey: `u/${me.id}/cover.webp`,
				contentType: "image/webp",
				width: 10,
				height: 10,
				bytes: 10,
			})
			.returning({ id: assets.id })
		id.asset = asset!.id
		garden = await article(me.id, "Garden", {
			siteName: "Gardens",
			author: "Ann",
			leadImageAssetId: asset!.id,
			note: "Prune the roses",
			noteUpdatedAt: ago(1),
		})
		const kitchen = await article(me.id, "Kitchen", { leadImageUrl: "https://img.test/k.jpg" })
		const attic = await article(me.id, "Attic", {
			note: "attic note",
			noteUpdatedAt: ago(0, 5),
			deletedAt: new Date(),
		})
		Object.assign(id, { garden: garden.id, kitchen: kitchen.id, attic: attic.id })
		id.first = await highlight(garden, "first passage", ago(5), { startOffset: 10, endOffset: 23 })
		id.second = await highlight(garden, "second passage", ago(4), {
			color: 1,
			note: "think about soil",
		})
		id.bread = await highlight(kitchen, "bread rises", ago(2))
		await highlight(garden, "deleted passage", ago(0, 1), { deletedAt: new Date() })
		await highlight(attic, "attic passage", ago(0, 2))
		const theirs = await article(other.id, "Theirs")
		await highlight(theirs, "first passage", ago(0, 3))
		const [tag] = await db.insert(tags).values({ userId: me.id, name: "home" }).returning()
		id.tag = tag!.id
		await db.insert(documentTags).values({ documentId: kitchen.id, tagId: tag!.id })
		const [theirTag] = await db.insert(tags).values({ userId: other.id, name: "x" }).returning()
		id.theirTag = theirTag!.id
	})

	it("lists articles by latest activity, each with its note and highlights in reading order", async () => {
		const page = await me.client.notebook.get()
		expect(page.view).toBe("articles")
		if (page.view !== "articles") throw new Error("by article")
		// Garden's note (a day ago) is newer than Kitchen's highlight (two days ago).
		expect(page.articles.map((a) => a.article.title)).toEqual(["Garden", "Kitchen"])
		const [garden, kitchen] = page.articles
		expect(garden).toMatchObject({
			article: {
				id: id.garden,
				title: "Garden",
				author: "Ann",
				site: "Gardens",
				readerUrl: `${origin}/read/${id.garden}`,
				leadImage: {
					url: `${origin}/assets/${id.asset}`,
					downloadUrl: `${origin}/api/v1/assets/${id.asset}`,
				},
			},
			note: "Prune the roses",
		})
		expect(garden!.noteUpdatedAt).toBe(
			(
				await db.select().from(documents).where(eq(documents.id, id.garden!))
			)[0]!.noteUpdatedAt!.toISOString(),
		)
		expect(garden!.highlights.map((h) => [h.quote, h.color, h.note])).toEqual([
			["second passage", "green", "think about soil"],
			["first passage", "yellow", null],
		])
		expect(kitchen).toMatchObject({
			note: null,
			noteUpdatedAt: null,
			article: { leadImage: { url: "https://img.test/k.jpg", downloadUrl: null } },
		})
		expect(page.counts).toEqual({
			all: 4,
			notes: 2,
			highlights: 3,
			shared: 0,
			yellow: 2,
			green: 1,
			blue: 0,
			pink: 0,
			orange: 0,
		})
		expect(page.tags).toEqual([{ id: id.tag, name: "home", count: 1 }])
		expect(page.topicsInUse).toBe(false)
		expect(page.topic).toBeNull()
	})

	it("pages 1 article at a time, and refuses a cursor it did not write", async () => {
		const first = await me.client.notebook.get({ limit: 1 })
		if (first.view !== "articles") throw new Error("by article")
		expect(first.articles.map((a) => a.article.title)).toEqual(["Garden"])
		expect(first.nextCursor).toEqual(expect.any(String))
		const second = await me.client.notebook.get({ limit: 1, cursor: first.nextCursor })
		if (second.view !== "articles") throw new Error("by article")
		expect(second.articles.map((a) => a.article.title)).toEqual(["Kitchen"])
		expect(second.nextCursor).toBeNull()

		const bad = await request("/api/v1/notebook?cursor=bm9wZQ", { token: me.key })
		expect(bad.status).toBe(400)
		expect(await bad.json()).toMatchObject({ error: { code: "invalid_request" } })
	})

	it("streams highlights and notes newest first, narrowed by a filter or a search", async () => {
		const stream = await me.client.notebook.get({ view: "stream" })
		if (stream.view !== "stream") throw new Error("stream")
		const cards = (items: typeof stream.items) =>
			items.map((i) => (i.kind === "note" ? `note: ${i.article.title}` : i.highlight.quote))
		expect(cards(stream.items)).toEqual([
			"note: Garden",
			"bread rises",
			"second passage",
			"first passage",
		])
		expect(stream.items[0]).toMatchObject({
			kind: "note",
			note: "Prune the roses",
			editable: true,
			noteUpdatedAt: garden.noteUpdatedAt!.toISOString(),
		})

		const notes = await me.client.notebook.get({ view: "stream", filter: "notes" })
		if (notes.view !== "stream") throw new Error("stream")
		expect(cards(notes.items)).toEqual(["note: Garden", "second passage"])

		const onlyHighlights = await me.client.notebook.get({ view: "stream", filter: "highlights" })
		if (onlyHighlights.view !== "stream") throw new Error("stream")
		expect(cards(onlyHighlights.items)).toEqual(["bread rises", "second passage", "first passage"])

		// The note's words, and a highlight note's words.
		const roses = await me.client.notebook.get({ view: "stream", q: "roses" })
		if (roses.view !== "stream") throw new Error("stream")
		expect(cards(roses.items)).toEqual(["note: Garden"])
		const soil = await me.client.notebook.get({ view: "stream", q: "soil" })
		if (soil.view !== "stream") throw new Error("stream")
		expect(cards(soil.items)).toEqual(["second passage"])
		expect(soil.counts.all).toBe(1)

		const paged = await me.client.notebook.get({ view: "stream", limit: 3 })
		if (paged.view !== "stream") throw new Error("stream")
		const rest = await me.client.notebook.get({
			view: "stream",
			limit: 3,
			cursor: paged.nextCursor,
		})
		if (rest.view !== "stream") throw new Error("stream")
		expect(cards(rest.items)).toEqual(["first passage"])
	})

	it("narrows to one of the user's tags; another reader's tag or topic is not found", async () => {
		const tagged = await me.client.notebook.get({ view: "stream", tag: id.tag })
		if (tagged.view !== "stream") throw new Error("stream")
		expect(tagged.items.map((i) => i.kind === "highlight" && i.highlight.quote)).toEqual([
			"bread rises",
		])
		// A tag of the user's with nothing kept under it stays chosen, with none.
		const [bare] = await db.insert(tags).values({ userId: me.id, name: "bare" }).returning()
		const empty = await me.client.notebook.get({ view: "stream", tag: bare!.id })
		if (empty.view !== "stream") throw new Error("stream")
		expect(empty.items).toEqual([])
		expect(empty.tags).toEqual([
			{ id: id.tag, name: "home", count: 1 },
			{ id: bare!.id, name: "bare", count: 0 },
		])
		expect((await errorOf(me.client.notebook.get({ tag: id.theirTag }))).code).toBe("not_found")
		expect((await errorOf(me.client.notebook.get({ tag: MISSING }))).code).toBe("not_found")
		// Topics are not in use for this reader.
		expect((await errorOf(me.client.notebook.get({ topic: "none" }))).code).toBe("not_found")
	})

	it("answers By article when By topic is asked while topics are not in use", async () => {
		const page = await me.client.notebook.get({ view: "topics" })
		expect(page.view).toBe("articles")
	})

	it("deals the same hand for the same seed, and needs one for Shuffle", async () => {
		const a = await me.client.notebook.get({ view: "shuffle", seed: "abc123" })
		const b = await me.client.notebook.get({ view: "shuffle", seed: "abc123" })
		if (a.view !== "shuffle" || b.view !== "shuffle") throw new Error("shuffle")
		expect(a.seed).toBe("abc123")
		expect(a.items).toHaveLength(4)
		expect(b.items).toEqual(a.items)

		// Each seed orders the cards by md5(id || seed): another seed deals them again.
		const hand = (seed: string) =>
			[
				[id.first!, "first passage"],
				[id.second!, "second passage"],
				[id.bread!, "bread rises"],
				[id.garden!, "note: Garden"],
			]
				.map(([key, card]) => ({ card, rank: md5(key + seed) }))
				.sort((x, y) => (x.rank < y.rank ? -1 : 1))
				.map((x) => x.card)
		const dealt = (items: NotebookItem[]) =>
			items.map((i) => (i.kind === "note" ? `note: ${i.article.title}` : i.highlight.quote))
		for (const seed of ["abc123", "zz9", "q"]) {
			const page = await me.client.notebook.get({ view: "shuffle", seed })
			if (page.view !== "shuffle") throw new Error("shuffle")
			expect(dealt(page.items)).toEqual(hand(seed))
		}

		const noSeed = await request("/api/v1/notebook?view=shuffle", { token: me.key })
		expect(noSeed.status).toBe(400)
		const strayCursor = await request("/api/v1/notebook?view=topics&cursor=x", { token: me.key })
		expect(strayCursor.status).toBe(400)
	})

	it("searches highlights and notes, grouped, with only the user's live ones", async () => {
		const found = await me.client.annotations.search("passage")
		expect(found.highlights.total).toBe(2)
		expect(found.highlights.items.map((h) => h.id).sort()).toEqual([id.first, id.second].sort())
		const second = found.highlights.items.find((h) => h.id === id.second)
		expect(second).toMatchObject({
			color: "green",
			quote: [{ text: "second " }, { text: "passage", match: true }],
			note: [{ text: "think about soil" }],
			article: { id: id.garden, title: "Garden", site: "Gardens" },
		})
		expect(found.notes).toEqual({ items: [], total: 0 })

		const roses = await me.client.annotations.search("roses")
		expect(roses.notes).toEqual({
			total: 1,
			items: [
				{
					note: [{ text: "Prune the " }, { text: "roses", match: true }],
					noteUpdatedAt: expect.any(String),
					article: { id: id.garden, title: "Garden", site: "Gardens" },
				},
			],
		})
		// The trashed article's note and highlight never show.
		const attic = await me.client.annotations.search("attic")
		expect(attic.highlights.total + attic.notes.total).toBe(0)

		const limited = await me.client.annotations.search("passage", { limit: 1, only: "highlights" })
		expect(limited.highlights.items).toHaveLength(1)
		expect(limited.highlights.total).toBe(2)

		// The other reader finds only theirs.
		const theirs = await other.client.annotations.search("passage")
		expect(theirs.highlights.items.map((h) => h.quote)).toEqual([
			[{ text: "first " }, { text: "passage", match: true }],
		])
		expect(theirs.highlights.items[0]!.id).not.toBe(id.first)
	})
})

describe("By topic in the API", () => {
	it("groups by topic; a note under two topics is editable only in the first", async () => {
		const me = await users.create("Topics")
		await db.insert(userFeatures).values({ userId: me.id, feature: "topics" })
		await db
			.insert(topicLibraries)
			.values({ userId: me.id, proposedAt: new Date(), confirmedAt: new Date() })
		const topic = async (name: string) =>
			(
				await db
					.insert(topics)
					.values({ userId: me.id, name, description: "d", status: "active", origin: "first" })
					.returning({ id: topics.id })
			)[0]!.id
		const [craft, design] = [await topic("Craft"), await topic("Design")]
		const both = await article(me.id, "Both", { note: "shared note", noteUpdatedAt: ago(1) })
		const one = await article(me.id, "One")
		await highlight(both, "both passage", ago(3))
		await highlight(one, "craft passage", ago(2))
		await highlight(one, "craft again", ago(2, -1))
		await db.insert(documentTopics).values([
			{ documentId: both.id, topicId: craft, probability: 0.9, level: "applied" },
			{ documentId: both.id, topicId: design, probability: 0.9, level: "applied" },
			{ documentId: one.id, topicId: craft, probability: 0.9, level: "applied" },
		])

		const page = await me.client.notebook.get({ view: "topics" })
		if (page.view !== "topics") throw new Error("by topic")
		expect(page.topicsInUse).toBe(true)
		expect(
			page.groups.map((g) => [
				g.topic?.name,
				g.highlights,
				g.notes,
				g.items.map((i) =>
					i.kind === "note" ? `note ${i.editable ? "editable" : "read-only"}` : i.highlight.quote,
				),
			]),
		).toEqual([
			["Craft", 3, 1, ["note editable", "craft again", "craft passage", "both passage"]],
			["Design", 1, 1, ["note read-only", "both passage"]],
		])

		const inDesign = await me.client.notebook.get({ view: "stream", topic: design })
		expect(inDesign.topic).toEqual({ id: design, name: "Design" })
		if (inDesign.view !== "stream") throw new Error("stream")
		expect(inDesign.items).toHaveLength(2)
		const stray = await request(`/api/v1/notebook?view=topics&topic=${design}`, { token: me.key })
		expect(stray.status).toBe(400)
	})
})

describe("Home's daily highlights in the API", () => {
	it("brings back old highlights for the device's day; dismiss and restore them", async () => {
		const me = await users.create("Daily")
		const other = await users.create("Other daily")
		const doc = await article(me.id, "Old", { siteName: "Site", author: "Ada Writer" })
		const old = await highlight(doc, "old passage", ago(30), { note: "a note", color: 2 })
		await highlight(doc, "too fresh", ago(1))

		const today = utcDay()
		const daily = await me.client.dailyHighlights.list(today)
		expect(daily).toEqual({
			day: today,
			items: [
				{
					id: old,
					quote: "old passage",
					note: "a note",
					color: "blue",
					article: {
						id: doc.id,
						title: "Old",
						site: "Site",
						author: "Ada Writer",
						url: doc.sourceUrl,
					},
				},
			],
			linkTargets: {},
		})
		// A device ahead of UTC is fine; a day that is nobody's today is refused.
		expect((await me.client.dailyHighlights.list(utcDay(1))).day).toBe(utcDay(1))
		expect((await me.client.dailyHighlights.list(utcDay(-1))).day).toBe(utcDay(-1))
		for (const offset of [-2, 2])
			expect((await errorOf(me.client.dailyHighlights.list(utcDay(offset)))).code).toBe(
				"invalid_request",
			)
		expect((await errorOf(me.client.dailyHighlights.list("2026-02-30"))).code).toBe(
			"invalid_request",
		)

		await me.client.dailyHighlights.dismiss(old)
		expect((await me.client.dailyHighlights.list(today)).items).toEqual([])
		await me.client.dailyHighlights.restore(old)
		expect((await me.client.dailyHighlights.list(today)).items.map((h) => h.id)).toEqual([old])

		// Someone else's highlight, or one of a trashed article: not found, and nothing written.
		expect((await errorOf(other.client.dailyHighlights.dismiss(old))).code).toBe("not_found")
		expect((await errorOf(other.client.dailyHighlights.restore(old))).code).toBe("not_found")
		expect(
			await db.select().from(highlightResurfacing).where(eq(highlightResurfacing.userId, other.id)),
		).toEqual([])
		await db.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, doc.id))
		expect((await errorOf(me.client.dailyHighlights.dismiss(old))).code).toBe("not_found")
		expect((await me.client.dailyHighlights.list(today)).items).toEqual([])
	})
})

describe("Home's question about notes in the API", () => {
	it("asks about an article listened to the end; Nothing to add, its undo, and Not now", async () => {
		const me = await users.create("Reminders")
		const other = await users.create("Other reminders")
		const doc = await article(me.id, "Heard", {
			siteName: "Site",
			author: "Ada Writer",
			firstOpenedAt: ago(1),
		})
		await highlight(doc, "a passage", ago(0), { color: 1 })
		expect(await me.client.noteReminders.list()).toEqual({ items: [], total: 0, suggested: false })

		// Read aloud part of the way, then to the end, as the app saves it.
		await me.client.articles.setPosition(doc.id, 0.5, { cycle: 0, listened: true })
		expect((await me.client.noteReminders.list()).total).toBe(0)
		await me.client.articles.setPosition(doc.id, 1, { cycle: 0, listened: true })
		const asked = await me.client.noteReminders.list()
		expect(asked).toMatchObject({
			items: [
				{
					article: {
						id: doc.id,
						title: "Heard",
						site: "Site",
						author: "Ada Writer",
						url: doc.sourceUrl,
					},
					listened: true,
					highlights: [{ quote: "a passage", color: "green" }],
				},
			],
			total: 1,
			suggested: true,
		})
		expect(Date.parse(asked.items[0]!.finishedAt)).toBeGreaterThan(Date.now() - 60_000)

		expect((await errorOf(other.client.articles.skipNote(doc.id))).code).toBe("not_found")
		await me.client.articles.skipNote(doc.id)
		expect((await me.client.noteReminders.list()).total).toBe(0)
		await me.client.articles.unskipNote(doc.id)
		expect((await me.client.noteReminders.list()).total).toBe(1)

		await me.client.noteReminders.snooze()
		expect(await me.client.noteReminders.list()).toMatchObject({ total: 1, suggested: false })
		expect((await other.client.noteReminders.list()).total).toBe(0)
	})
})

describe("links in notes", () => {
	it("says which linked articles are there, or in the trash, in every view and on Home", async () => {
		const me = await users.create("Links")
		const live = await article(me.id, "Live")
		const binned = await article(me.id, "Binned", { deletedAt: new Date() })
		const link = (a: { id: string }, title: string) => `[${title}](/read/${a.id})`
		const doc = await article(me.id, "Linking", {
			note: `See ${link(live, "Live")} and ${link({ id: MISSING }, "Gone")}`,
			noteUpdatedAt: ago(1),
		})
		await highlight(doc, "old linking passage", ago(30), { note: `Also ${link(binned, "Binned")}` })
		const targets = { [live.id]: "ok", [binned.id]: "trash" }

		for (const view of ["articles", "stream"] as const)
			expect((await me.client.notebook.get({ view })).linkTargets).toEqual(targets)
		expect((await me.client.notebook.get({ view: "shuffle", seed: "a" })).linkTargets).toEqual(
			targets,
		)
		// Home's highlight carries only its own note's link.
		expect((await me.client.dailyHighlights.list(utcDay())).linkTargets).toEqual({
			[binned.id]: "trash",
		})
	})
})
