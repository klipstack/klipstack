import { createHash } from "node:crypto"
import {
	db,
	documents,
	documentTags,
	documentTopics,
	documentVersions,
	eq,
	highlights,
	tags,
	topics,
	user as userTable,
} from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
	activeTopicName,
	dealHighlights,
	listHighlightTags,
	listHighlightTopics,
} from "./highlight-board.server"
import {
	countHighlightFilters,
	listHighlightArticles,
	listUserHighlights,
} from "./highlights.server"

const userId = `test-hl-board-${Date.now()}`
const otherId = `${userId}-other`
const ids: Record<string, string> = {}
let minute = 0

async function article(
	owner: string,
	title: string,
	values: Partial<typeof documents.$inferInsert> = {},
) {
	const [d] = await db
		.insert(documents)
		.values({
			userId: owner,
			sourceUrl: `https://example.com/${encodeURIComponent(title)}`,
			urlHash: `${owner}-${title}`,
			title,
			status: "ready",
			...values,
		})
		.returning({ id: documents.id })
	const [v] = await db
		.insert(documentVersions)
		.values({
			documentId: d!.id,
			version: 1,
			html: "<p>x</p>",
			text: "x",
			textHash: createHash("sha256").update(title).digest("hex"),
			extractor: "test",
			extractorVersion: "0",
		})
		.returning({ id: documentVersions.id })
	await db.update(documents).set({ currentVersionId: v!.id }).where(eq(documents.id, d!.id))
	return { id: d!.id, versionId: v!.id }
}

async function highlight(
	owner: string,
	doc: { id: string; versionId: string },
	exact: string,
	values: Partial<typeof highlights.$inferInsert> = {},
) {
	minute += 1
	const [h] = await db
		.insert(highlights)
		.values({
			userId: owner,
			documentId: doc.id,
			versionId: doc.versionId,
			startOffset: 0,
			endOffset: 1,
			exact,
			createdAt: new Date(Date.UTC(2026, 8, 1, 0, minute)),
			...values,
		})
		.returning({ id: highlights.id })
	ids[exact] = h!.id
	return h!.id
}

async function topic(owner: string, name: string, status: "active" | "retired" = "active") {
	const [t] = await db
		.insert(topics)
		.values({ userId: owner, name, description: `About ${name}.`, status, origin: "first" })
		.returning({ id: topics.id })
	return t!.id
}

const put = (
	documentId: string,
	topicId: string,
	extra: Partial<typeof documentTopics.$inferInsert> = {},
) =>
	db
		.insert(documentTopics)
		.values({ documentId, topicId, probability: 0.9, level: "applied", ...extra })

const quotes = (items: { exact: string }[]) => items.map((h) => h.exact)

beforeAll(async () => {
	await db.insert(userTable).values([
		{ id: userId, name: "B", email: `${userId}@example.com` },
		{ id: otherId, name: "O", email: `${otherId}@example.com` },
	])
	ids.design = await topic(userId, "Design")
	ids.craft = await topic(userId, "Craft")
	ids.old = await topic(userId, "Old", "retired")
	ids.theirs = await topic(otherId, "Theirs")

	// In two topics: its highlights show under both.
	const both = await article(userId, "Both", { leadImageUrl: "https://img.example.com/a.jpg" })
	await put(both.id, ids.design)
	await put(both.id, ids.craft)
	await highlight(userId, both, "both one", { color: 1 })
	await highlight(userId, both, "both two", { note: "A note" })

	const design = await article(userId, "Design only")
	await put(design.id, ids.design)
	await highlight(userId, design, "design one", { color: 2 })

	// Suggested, refused or in a retired topic: in none of the reader's topics.
	const loose = await article(userId, "Loose")
	await put(loose.id, ids.craft, { level: "suggested" })
	await put(loose.id, ids.design, { refusedAt: new Date() })
	await put(loose.id, ids.old)
	await highlight(userId, loose, "loose one")
	const unsorted = await article(userId, "Unsorted")
	await highlight(userId, unsorted, "unsorted one")

	// Gone: never counted.
	await highlight(userId, design, "deleted one", { deletedAt: new Date() })
	const trashed = await article(userId, "Trashed", { deletedAt: new Date() })
	await put(trashed.id, ids.design)
	await highlight(userId, trashed, "trashed one")

	// Another reader's.
	const theirs = await article(otherId, "Theirs")
	await put(theirs.id, ids.theirs)
	await highlight(otherId, theirs, "their one")

	const [reading] = await db
		.insert(tags)
		.values([{ userId, name: "reading" }])
		.returning({ id: tags.id })
	const [empty] = await db
		.insert(tags)
		.values([{ userId, name: "empty" }])
		.returning({ id: tags.id })
	ids.reading = reading!.id
	ids.empty = empty!.id
	await db.insert(documentTags).values([
		{ documentId: both.id, tagId: ids.reading },
		{ documentId: unsorted.id, tagId: ids.reading },
		{ documentId: trashed.id, tagId: ids.reading },
	])
	// A tag on an article without highlights is not offered.
	const bare = await article(userId, "Bare")
	await db.insert(documentTags).values({ documentId: bare.id, tagId: ids.empty })
})

afterAll(async () => {
	await db.delete(userTable).where(eq(userTable.id, userId))
	await db.delete(userTable).where(eq(userTable.id, otherId))
})

describe("highlights by topic", () => {
	it("groups under every topic an article is listed in, most highlighted first, Other last", async () => {
		const groups = await listHighlightTopics({ userId })
		expect(groups.map((g) => [g.name, g.count, quotes(g.highlights)])).toEqual([
			["Design", 3, ["design one", "both two", "both one"]],
			["Craft", 2, ["both two", "both one"]],
			[null, 2, ["unsorted one", "loose one"]],
		])
		expect(groups[0]!.topicId).toBe(ids.design)
		expect(groups.at(-1)!.topicId).toBeNull()
		// Cards carry their article, cover included.
		const card = groups[0]!.highlights.find((h) => h.exact === "both one")
		expect(card).toMatchObject({ documentTitle: "Both", image: "https://img.example.com/a.jpg" })
	})

	it("shows each group's newest few, and counts them all", async () => {
		const groups = await listHighlightTopics({ userId, perTopic: 1 })
		expect(groups.map((g) => [g.name, g.count, quotes(g.highlights)])).toEqual([
			["Design", 3, ["design one"]],
			["Craft", 2, ["both two"]],
			[null, 2, ["unsorted one"]],
		])
	})

	it("keeps to the search, the filter and the tag", async () => {
		const named = (groups: Awaited<ReturnType<typeof listHighlightTopics>>) =>
			groups.map((g) => [g.name, quotes(g.highlights)])
		expect(named(await listHighlightTopics({ userId, filter: "notes" }))).toEqual([
			["Craft", ["both two"]],
			["Design", ["both two"]],
		])
		expect(named(await listHighlightTopics({ userId, filter: "blue" }))).toEqual([
			["Design", ["design one"]],
		])
		expect(named(await listHighlightTopics({ userId, q: "loose" }))).toEqual([
			[null, ["loose one"]],
		])
		expect(named(await listHighlightTopics({ userId, scope: { tagId: ids.reading } }))).toEqual([
			["Craft", ["both two", "both one"]],
			["Design", ["both two", "both one"]],
			[null, ["unsorted one"]],
		])
	})
})

describe("the stream and by article, narrowed by tag and topic", () => {
	it("a tag keeps the highlights of its articles", async () => {
		const { items } = await listUserHighlights({ userId, scope: { tagId: ids.reading } })
		expect(quotes(items)).toEqual(["unsorted one", "both two", "both one"])
		const articles = await listHighlightArticles({ userId, scope: { tagId: ids.reading } })
		expect(articles.map((a) => a.documentTitle)).toEqual(["Unsorted", "Both"])
		expect(articles[1]!.image).toBe("https://img.example.com/a.jpg")
		expect(await countHighlightFilters(userId, undefined, { tagId: ids.reading })).toMatchObject({
			notes: 1,
			yellow: 2,
			green: 1,
		})
	})

	it("a topic keeps its articles' highlights; none keeps those in no topic", async () => {
		const topic = async (t: string) =>
			quotes((await listUserHighlights({ userId, scope: { topic: t } })).items)
		expect(await topic(ids.design!)).toEqual(["design one", "both two", "both one"])
		expect(await topic("none")).toEqual(["unsorted one", "loose one"])
		// Another reader's topic holds none of this reader's articles.
		expect(await topic(ids.theirs!)).toEqual([])
	})

	it("names a topic only when it is the reader's and active", async () => {
		expect(await activeTopicName(userId, ids.design!)).toBe("Design")
		expect(await activeTopicName(userId, ids.old!)).toBeNull()
		expect(await activeTopicName(userId, ids.theirs!)).toBeNull()
	})
})

describe("shuffle", () => {
	it("deals a hand: the same for a seed, another for another seed, within the matching", async () => {
		const hand = quotes(await dealHighlights({ userId, seed: "a", size: 3 }))
		expect(hand).toHaveLength(3)
		expect(quotes(await dealHighlights({ userId, seed: "a", size: 3 }))).toEqual(hand)
		const all = ["both one", "both two", "design one", "loose one", "unsorted one"]
		const hands = new Set<string>()
		for (const seed of ["b", "c", "d", "e", "f", "g"]) {
			const dealt = quotes(await dealHighlights({ userId, seed }))
			expect([...dealt].sort()).toEqual(all)
			hands.add(dealt.join())
		}
		expect(hands.size).toBeGreaterThan(1)
		expect(quotes(await dealHighlights({ userId, seed: "a", filter: "notes" }))).toEqual([
			"both two",
		])
	})
})

describe("tags to narrow by", () => {
	it("the reader's tags whose live articles have highlights, with how many", async () => {
		expect(await listHighlightTags(userId)).toEqual([
			{ id: ids.reading, name: "reading", count: 3 },
		])
		expect(await listHighlightTags(otherId)).toEqual([])
	})
})
