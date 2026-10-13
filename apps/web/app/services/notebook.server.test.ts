import { createHash } from "node:crypto"
import {
	db,
	documents,
	documentTags,
	documentTopics,
	documentVersions,
	eq,
	highlights,
	sql,
	tags,
	topics,
	user as userTable,
} from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { setArticleNote } from "~/commands/annotations.server"
import {
	activeTopicName,
	countNotebook,
	dealNotebook,
	listNotebookArticles,
	listNotebookStream,
	listNotebookTags,
	listNotebookTopics,
	type NotebookItem,
} from "./notebook.server"

const userId = `test-notebook-${Date.now()}`
const otherId = `${userId}-other`
const emptyId = `${userId}-empty`
const ids: Record<string, string> = {}

/** 1 September 2026, `minute` minutes past midnight. */
const at = (minute: number) => new Date(Date.UTC(2026, 8, 1, 0, minute))

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
			siteName: "Example",
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
			textHash: createHash("sha256").update(`${owner}${title}`).digest("hex"),
			extractor: "test",
			extractorVersion: "0",
		})
		.returning({ id: documentVersions.id })
	await db.update(documents).set({ currentVersionId: v!.id }).where(eq(documents.id, d!.id))
	ids[title] = d!.id
	return { id: d!.id, versionId: v!.id }
}

async function highlight(
	owner: string,
	doc: { id: string; versionId: string },
	exact: string,
	minute: number,
	values: Partial<typeof highlights.$inferInsert> = {},
) {
	await db.insert(highlights).values({
		userId: owner,
		documentId: doc.id,
		versionId: doc.versionId,
		startOffset: 0,
		endOffset: 1,
		exact,
		createdAt: at(minute),
		...values,
	})
}

/** An article note, written at `minute` (the trigger keeps its search vector). */
const note = (doc: { id: string }, text: string, minute: number | null) =>
	db
		.update(documents)
		.set({ note: text, noteUpdatedAt: minute === null ? null : at(minute) })
		.where(eq(documents.id, doc.id))

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

/** A card by what it shows: a highlight's quote, or the title of a note's article. */
const shown = (items: NotebookItem[]) =>
	items.map((i) => (i.kind === "highlight" ? i.exact : `note: ${i.documentTitle}`))

/**
 * The reader's notebook, oldest first:
 *   Imported's note: never saved here, on an article saved a year ago
 *   1 "both one" (green), 2 "both two" (with a note), on Both: in Design and Craft, tagged reading
 *   3 "design one" (blue), on Design only: in Design
 *   4 "loose one", on Loose: suggested, refused, or in a retired topic
 *   5 "unsorted one", on Unsorted: tagged reading
 *   6 the note on Pondered, which has no highlight: in Craft, tagged thinking
 *   7 the note on Both
 * Never shown: a deleted highlight, a cleared note, an article in the trash, another reader's.
 */
beforeAll(async () => {
	await db.insert(userTable).values([
		{ id: userId, name: "B", email: `${userId}@example.com` },
		{ id: otherId, name: "O", email: `${otherId}@example.com` },
		{ id: emptyId, name: "E", email: `${emptyId}@example.com` },
	])
	ids.design = await topic(userId, "Design")
	ids.craft = await topic(userId, "Craft")
	ids.old = await topic(userId, "Old", "retired")
	ids.theirs = await topic(otherId, "Theirs")

	const imported = await article(userId, "Imported", { createdAt: new Date(Date.UTC(2025, 0, 1)) })
	await note(imported, "Brought in from elsewhere", null)

	const both = await article(userId, "Both", { leadImageUrl: "https://img.example.com/a.jpg" })
	await put(both.id, ids.design)
	await put(both.id, ids.craft)
	await highlight(userId, both, "both one", 1, { color: 1 })
	await highlight(userId, both, "both two", 2, { note: "A note" })
	await note(both, "Thoughts on both", 7)

	const design = await article(userId, "Design only", {
		leadImageAssetId: "0198c0de-0000-7000-8000-0000000000aa",
		leadImageUrl: "https://img.example.com/ignored.jpg",
	})
	await put(design.id, ids.design)
	await highlight(userId, design, "design one", 3, { color: 2 })
	await highlight(userId, design, "deleted one", 8, { deletedAt: new Date() })

	const loose = await article(userId, "Loose")
	await put(loose.id, ids.craft, { level: "suggested" })
	await put(loose.id, ids.design, { refusedAt: new Date() })
	await put(loose.id, ids.old)
	await highlight(userId, loose, "loose one", 4)
	const unsorted = await article(userId, "Unsorted")
	await highlight(userId, unsorted, "unsorted one", 5)

	const noted = await article(userId, "Pondered")
	await put(noted.id, ids.craft)
	await note(noted, "Musings on craft", 6)

	const cleared = await article(userId, "Cleared")
	await note(cleared, "  ", 9)
	const trashed = await article(userId, "Trashed", { deletedAt: new Date() })
	await put(trashed.id, ids.design)
	await highlight(userId, trashed, "trashed one", 9)
	await note(trashed, "Thoughts in the trash", 9)
	const theirs = await article(otherId, "Theirs")
	await put(theirs.id, ids.theirs)
	await highlight(otherId, theirs, "their one", 9)
	await note(theirs, "Their thoughts", 9)

	const made = await db
		.insert(tags)
		.values([
			{ userId, name: "reading" },
			{ userId, name: "thinking" },
			{ userId, name: "empty" },
		])
		.returning({ id: tags.id, name: tags.name })
	for (const t of made) ids[t.name] = t.id
	const bare = await article(userId, "Bare")
	await db.insert(documentTags).values([
		{ documentId: both.id, tagId: ids.reading! },
		{ documentId: unsorted.id, tagId: ids.reading! },
		{ documentId: trashed.id, tagId: ids.reading! },
		{ documentId: noted.id, tagId: ids.thinking! },
		// A tag on an article with nothing kept is not offered.
		{ documentId: bare.id, tagId: ids.empty! },
	])
})

afterAll(async () => {
	for (const id of [userId, otherId, emptyId])
		await db.delete(userTable).where(eq(userTable.id, id))
})

describe("the stream", () => {
	it("holds highlights and article notes, newest first, each note by its last edit", async () => {
		const { items, nextCursor } = await listNotebookStream({ userId })
		expect(shown(items)).toEqual([
			"note: Both",
			"note: Pondered",
			"unsorted one",
			"loose one",
			"design one",
			"both two",
			"both one",
			"note: Imported",
		])
		expect(nextCursor).toBeNull()
		// A note carries its article, and what a save in place replaces.
		expect(items[0]).toMatchObject({
			kind: "note",
			documentId: ids.Both,
			note: "Thoughts on both",
			image: "https://img.example.com/a.jpg",
			siteName: "Example",
			noteUpdatedAt: at(7),
		})
		expect(items.at(-1)).toMatchObject({ kind: "note", noteUpdatedAt: null })
	})

	it("pages through both kinds without a gap or a repeat", async () => {
		const seen: string[] = []
		let cursor = null
		do {
			const page: Awaited<ReturnType<typeof listNotebookStream>> = await listNotebookStream({
				userId,
				limit: 3,
				cursor,
			})
			seen.push(...shown(page.items))
			cursor = page.nextCursor
		} while (cursor)
		expect(seen).toEqual(shown((await listNotebookStream({ userId })).items))
	})

	it("pages through times a microsecond apart, and a highlight and a note at the same one", async () => {
		const owner = `${userId}-micro`
		await db.insert(userTable).values({ id: owner, name: "M", email: `${owner}@example.com` })
		try {
			const time = (us: number) => sql`${`2026-09-02T00:00:00.000${us}Z`}::timestamptz`
			const docs = []
			for (const [title, us] of [
				["A", 101],
				["B", 102],
				["C", 103],
			] as const) {
				const doc = await article(owner, title)
				await db
					.update(documents)
					.set({ note: `On ${title}`, noteUpdatedAt: time(us) as unknown as Date })
					.where(eq(documents.id, doc.id))
				docs.push(doc)
			}
			await db.insert(highlights).values({
				userId: owner,
				documentId: docs[0]!.id,
				versionId: docs[0]!.versionId,
				startOffset: 0,
				endOffset: 1,
				exact: "same instant as B",
				createdAt: time(102) as unknown as Date,
			})
			const seen: string[] = []
			let cursor = null
			do {
				const page: Awaited<ReturnType<typeof listNotebookStream>> = await listNotebookStream({
					userId: owner,
					limit: 1,
					cursor,
				})
				seen.push(...shown(page.items))
				cursor = page.nextCursor
			} while (cursor)
			expect(seen).toHaveLength(4)
			expect(seen[0]).toBe("note: C")
			expect(seen.at(-1)).toBe("note: A")
			expect(new Set(seen).size).toBe(4)
			const articles: string[] = []
			let next = null
			do {
				const page: Awaited<ReturnType<typeof listNotebookArticles>> = await listNotebookArticles({
					userId: owner,
					limit: 1,
					cursor: next,
				})
				articles.push(...page.articles.map((a) => a.documentTitle ?? ""))
				next = page.nextCursor
			} while (next)
			expect(articles).toEqual(["C", "B", "A"])
		} finally {
			await db.delete(userTable).where(eq(userTable.id, owner))
		}
	})

	it("Notes: article notes and highlights with a note; Highlights and a color: no article note", async () => {
		const list = async (filter: "notes" | "highlights" | "blue") =>
			shown((await listNotebookStream({ userId, filter })).items)
		expect(await list("notes")).toEqual([
			"note: Both",
			"note: Pondered",
			"both two",
			"note: Imported",
		])
		expect(await list("highlights")).toEqual([
			"unsorted one",
			"loose one",
			"design one",
			"both two",
			"both one",
		])
		expect(await list("blue")).toEqual(["design one"])
	})

	it("one search finds quotes, highlight notes and article notes, accents and case aside", async () => {
		const find = async (q: string) => shown((await listNotebookStream({ userId, q })).items)
		expect(await find("THOUGHTS")).toEqual(["note: Both"])
		expect(await find("musing")).toEqual(["note: Pondered"])
		expect(await find('"a note"')).toEqual(["both two"])
		expect(await find("both")).toEqual(["note: Both", "both two", "both one"])
		// An article note matches its own words, not its article's title.
		expect(await find("pondered")).toEqual([])
		expect(await find("thoughts zebra")).toEqual([])
	})

	it("narrows by tag and topic, notes included", async () => {
		const list = async (scope: { tagId?: string; topic?: string }) =>
			shown((await listNotebookStream({ userId, scope })).items)
		expect(await list({ tagId: ids.reading })).toEqual([
			"note: Both",
			"unsorted one",
			"both two",
			"both one",
		])
		expect(await list({ tagId: ids.thinking })).toEqual(["note: Pondered"])
		expect(await list({ topic: ids.craft })).toEqual([
			"note: Both",
			"note: Pondered",
			"both two",
			"both one",
		])
		expect(await list({ topic: "none" })).toEqual(["unsorted one", "loose one", "note: Imported"])
		// Another reader's topic holds none of this reader's articles.
		expect(await list({ topic: ids.theirs })).toEqual([])
	})

	it("is empty for a reader with nothing kept", async () => {
		expect(await listNotebookStream({ userId: emptyId })).toEqual({ items: [], nextCursor: null })
	})
})

describe("by article", () => {
	const titles = (articles: Array<{ documentTitle: string | null }>) =>
		articles.map((a) => a.documentTitle)

	it("by latest activity, a new highlight or a note's edit, each with its note and highlights", async () => {
		const { articles, nextCursor } = await listNotebookArticles({ userId })
		expect(titles(articles)).toEqual([
			"Both",
			"Pondered",
			"Unsorted",
			"Loose",
			"Design only",
			"Imported",
		])
		expect(nextCursor).toBeNull()
		expect(articles[0]).toMatchObject({
			documentId: ids.Both,
			note: "Thoughts on both",
			noteUpdatedAt: at(7),
			image: "https://img.example.com/a.jpg",
		})
		expect(articles[0]!.highlights.map((h) => h.exact)).toEqual(["both one", "both two"])
		// Without a note: null, for the blank post-it to write one on.
		expect(articles[2]).toMatchObject({ note: null, noteUpdatedAt: null })
		// A note alone makes an article, without highlights.
		expect(articles[1]!.highlights).toEqual([])
		expect(articles[4]!.image).toBe("/assets/0198c0de-0000-7000-8000-0000000000aa")
	})

	it("a highlight newer than the note moves its article up", async () => {
		const doc = await db.query.documents.findFirst({ where: eq(documents.id, ids.Pondered!) })
		const later = await article(userId, "Later")
		await highlight(userId, later, "later one", 30)
		await note(later, "Written first", 20)
		await highlight(
			userId,
			{ id: ids.Pondered!, versionId: doc!.currentVersionId! },
			"noted one",
			25,
		)
		try {
			const { articles } = await listNotebookArticles({ userId, limit: 3 })
			expect(titles(articles)).toEqual(["Later", "Pondered", "Both"])
		} finally {
			await db.delete(documents).where(eq(documents.id, later.id))
			await db.delete(highlights).where(eq(highlights.exact, "noted one"))
		}
	})

	it("pages by article", async () => {
		const first = await listNotebookArticles({ userId, limit: 4 })
		expect(titles(first.articles)).toEqual(["Both", "Pondered", "Unsorted", "Loose"])
		const second = await listNotebookArticles({ userId, limit: 4, cursor: first.nextCursor })
		expect(titles(second.articles)).toEqual(["Design only", "Imported"])
		expect(second.nextCursor).toBeNull()
	})

	it("keeps to the filter, the search and the tag; the note stays beside what matches", async () => {
		const notes = await listNotebookArticles({ userId, filter: "notes" })
		expect(titles(notes.articles)).toEqual(["Both", "Pondered", "Imported"])
		expect(notes.articles[0]!.highlights.map((h) => h.exact)).toEqual(["both two"])
		const marked = await listNotebookArticles({ userId, filter: "highlights" })
		expect(titles(marked.articles)).toEqual(["Both", "Unsorted", "Loose", "Design only"])
		expect(marked.articles[0]!.note).toBe("Thoughts on both")
		const green = await listNotebookArticles({ userId, filter: "green" })
		expect(titles(green.articles)).toEqual(["Both"])
		expect(green.articles[0]!.highlights.map((h) => h.exact)).toEqual(["both one"])
		// Found by its note alone: the article, with none of its highlights.
		const thoughts = await listNotebookArticles({ userId, q: "thoughts" })
		expect(titles(thoughts.articles)).toEqual(["Both"])
		expect(thoughts.articles[0]!.highlights).toEqual([])
		const tagged = await listNotebookArticles({ userId, scope: { tagId: ids.reading } })
		expect(titles(tagged.articles)).toEqual(["Both", "Unsorted"])
	})
})

describe("by topic", () => {
	const groups = (list: Awaited<ReturnType<typeof listNotebookTopics>>) =>
		list.map((g) => [g.name, g.highlights, g.notes, shown(g.items)])

	it("under every topic an article is listed in, the fullest first, Other last; notes too", async () => {
		const list = await listNotebookTopics({ userId })
		expect(groups(list)).toEqual([
			["Craft", 2, 2, ["note: Both", "note: Pondered", "both two", "both one"]],
			["Design", 3, 1, ["note: Both", "design one", "both two", "both one"]],
			[null, 2, 1, ["unsorted one", "loose one", "note: Imported"]],
		])
		expect(list[0]!.topicId).toBe(ids.craft)
		expect(list.at(-1)!.topicId).toBeNull()
		// Cards carry their article, cover included.
		const card = list[1]!.items.find((i) => i.kind === "highlight" && i.exact === "design one")
		expect(card).toMatchObject({ image: "/assets/0198c0de-0000-7000-8000-0000000000aa" })
		expect(list[1]!.items[0]).toMatchObject({ kind: "note", noteUpdatedAt: at(7) })
		// Without a cover, none.
		expect(list.at(-1)!.items[0]).toMatchObject({ kind: "highlight", image: null })
	})

	it("shows each group's newest few, and counts them all", async () => {
		expect(groups(await listNotebookTopics({ userId, perTopic: 1 }))).toEqual([
			["Craft", 2, 2, ["note: Both"]],
			["Design", 3, 1, ["note: Both"]],
			[null, 2, 1, ["unsorted one"]],
		])
	})

	it("keeps to the search, the filter and the tag", async () => {
		const named = async (m: Parameters<typeof listNotebookTopics>[0]) =>
			(await listNotebookTopics(m)).map((g) => [g.name, shown(g.items)])
		expect(await named({ userId, filter: "blue" })).toEqual([["Design", ["design one"]]])
		// Notes: highlights with a note and article notes, together.
		expect(await named({ userId, filter: "notes" })).toEqual([
			["Craft", ["note: Both", "note: Pondered", "both two"]],
			["Design", ["note: Both", "both two"]],
			[null, ["note: Imported"]],
		])
		expect(await named({ userId, q: "musings" })).toEqual([["Craft", ["note: Pondered"]]])
		expect(await named({ userId, scope: { tagId: ids.reading } })).toEqual([
			["Craft", ["note: Both", "both two", "both one"]],
			["Design", ["note: Both", "both two", "both one"]],
			[null, ["unsorted one"]],
		])
	})
})

describe("shuffle", () => {
	it("deals a hand of both kinds: the same for a seed, another for another seed", async () => {
		const all = [
			"both one",
			"both two",
			"design one",
			"loose one",
			"note: Both",
			"note: Imported",
			"note: Pondered",
			"unsorted one",
		]
		const hand = shown(await dealNotebook({ userId, seed: "a", size: 3 }))
		expect(hand).toHaveLength(3)
		expect(shown(await dealNotebook({ userId, seed: "a", size: 3 }))).toEqual(hand)
		const hands = new Set<string>()
		for (const seed of ["b", "c", "d", "e", "f", "g"]) {
			const dealt = shown(await dealNotebook({ userId, seed }))
			expect([...dealt].sort()).toEqual(all)
			hands.add(dealt.join())
		}
		expect(hands.size).toBeGreaterThan(1)
		// A hand of size n is the first n of the whole deal.
		expect(shown(await dealNotebook({ userId, seed: "b" })).slice(0, 3)).toEqual(
			shown(await dealNotebook({ userId, seed: "b", size: 3 })),
		)
		expect(shown(await dealNotebook({ userId, seed: "a", filter: "pink" }))).toEqual([])
	})
})

describe("filter counts, tags and topics", () => {
	it("counts what each filter shows, within the search and the scope", async () => {
		expect(await countNotebook(userId)).toEqual({
			all: 8,
			notes: 4,
			highlights: 5,
			yellow: 3,
			green: 1,
			blue: 1,
			pink: 0,
			orange: 0,
		})
		expect(await countNotebook(userId, undefined, { tagId: ids.reading })).toMatchObject({
			all: 4,
			notes: 2,
			highlights: 3,
		})
		expect(await countNotebook(userId, "thoughts")).toMatchObject({
			all: 1,
			notes: 1,
			highlights: 0,
		})
		expect((await countNotebook(emptyId)).all).toBe(0)
	})

	it("offers the reader's tags whose live articles have highlights or a note", async () => {
		expect(await listNotebookTags(userId)).toEqual([
			{ id: ids.reading, name: "reading", count: 4 },
			{ id: ids.thinking, name: "thinking", count: 1 },
		])
		expect(await listNotebookTags(otherId)).toEqual([])
	})

	it("names a topic only when it is the reader's and active", async () => {
		expect(await activeTopicName(userId, ids.design!)).toBe("Design")
		expect(await activeTopicName(userId, ids.old!)).toBeNull()
		expect(await activeTopicName(userId, ids.theirs!)).toBeNull()
	})

	it("an article note saved through the command shows at once, by its new time", async () => {
		const doc = await article(userId, "Fresh")
		try {
			await setArticleNote(userId, doc.id, { note: "Just now" })
			const { items } = await listNotebookStream({ userId, limit: 1 })
			expect(shown(items)).toEqual(["note: Fresh"])
		} finally {
			await db.delete(documents).where(eq(documents.id, doc.id))
		}
	})
})
