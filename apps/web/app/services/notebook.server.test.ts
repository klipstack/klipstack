import { db, documents, eq, user as userTable } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { setArticleNote } from "~/commands/annotations.server"
import { trashArticles, updateArticles } from "~/commands/articles.server"
import { hasAnyNote, listNotebook, notebookTags } from "./notebook.server"

const tag = `test-notebook-${Date.now()}`
const userId = `${tag}-a`
const otherId = `${tag}-b`
const emptyId = `${tag}-c`

async function article(
	owner: string,
	title: string,
	fields: Partial<typeof documents.$inferInsert> = {},
) {
	const [doc] = await db
		.insert(documents)
		.values({
			userId: owner,
			sourceUrl: `https://example.com/${tag}/${Math.random()}`,
			urlHash: `${tag}-${Math.random()}`,
			status: "ready",
			title,
			siteName: "Example",
			...fields,
		})
		.returning({ id: documents.id })
	return doc!.id
}

const titles = (page: { items: Array<{ title: string }> }) => page.items.map((n) => n.title)

/**
 * Notes, most recently edited first: First (revised last), Third, Second (tagged alpha and Birds,
 * starred), Imported (a note that never went through a save, on an article saved long ago). Not
 * listed: a cleared note, one in the trash, another reader's.
 */
let first: string
beforeAll(async () => {
	await db.insert(userTable).values([
		{ id: userId, name: "A", email: `${userId}@example.com` },
		{ id: otherId, name: "B", email: `${otherId}@example.com` },
		{ id: emptyId, name: "C", email: `${emptyId}@example.com` },
	])
	await article(userId, "Imported", {
		note: "Thoughts brought in from elsewhere",
		createdAt: new Date(Date.now() - 365 * 24 * 3600 * 1000),
	})
	first = await article(userId, "First", { leadImageUrl: "https://img.example/1.jpg" })
	const second = await article(userId, "Second")
	const third = await article(userId, "Third")
	const cleared = await article(userId, "Cleared")
	const trashed = await article(userId, "Trashed")
	await article(userId, "Without a note")
	const foreign = await article(otherId, "Not mine")
	await setArticleNote(otherId, foreign, { note: "Someone else's thoughts" })
	await setArticleNote(userId, first, { note: "Thoughts on the first" })
	await setArticleNote(userId, second, { note: "Thoughts on the second" })
	await setArticleNote(userId, third, { note: "Thoughts on the third" })
	await setArticleNote(userId, cleared, { note: "Thoughts soon gone" })
	await setArticleNote(userId, cleared, { note: "  " })
	await setArticleNote(userId, trashed, { note: "Thoughts in the trash" })
	await trashArticles(userId, [trashed])
	await updateArticles(userId, { ids: [second], addTags: ["Birds", "alpha"], starred: true })
	await updateArticles(userId, { ids: [trashed], addTags: ["gone"] })
	// Editing the first moves it to the top.
	await setArticleNote(userId, first, { note: "Thoughts on the first, revised" })
})

afterAll(async () => {
	for (const id of [userId, otherId, emptyId])
		await db.delete(userTable).where(eq(userTable.id, id))
})

describe("the notebook", () => {
	it("lists every note, most recently edited first, with its article and tags", async () => {
		const page = await listNotebook({ userId })
		expect(titles(page)).toEqual(["First", "Third", "Second", "Imported"])
		expect(page.items[0]).toMatchObject({
			documentId: first,
			siteName: "Example",
			image: "https://img.example/1.jpg",
			note: "Thoughts on the first, revised",
			tags: [],
		})
		expect(page.items[0]!.noteUpdatedAt).toBeInstanceOf(Date)
		expect(page.items[2]!.tags).toEqual(["alpha", "Birds"])
		// Never saved: sorted by when its article was saved, and saved in place as "never saved".
		expect(page.items[3]!.noteUpdatedAt).toBeNull()
		expect(page.nextCursor).toBeNull()
	})

	it("pages without overlap", async () => {
		const page1 = await listNotebook({ userId, limit: 3 })
		expect(titles(page1)).toEqual(["First", "Third", "Second"])
		const page2 = await listNotebook({ userId, limit: 3, cursor: page1.nextCursor })
		expect(titles(page2)).toEqual(["Imported"])
		expect(page2.nextCursor).toBeNull()
	})

	it("finds notes by their words, as the search page does, within its operators", async () => {
		expect(titles(await listNotebook({ userId, q: "revised" }))).toEqual(["First"])
		expect(titles(await listNotebook({ userId, q: "thought" }))).toEqual([
			"First",
			"Third",
			"Second",
			"Imported",
		])
		// The article's title is not the note.
		expect(titles(await listNotebook({ userId, q: "Without" }))).toEqual([])
		expect(titles(await listNotebook({ userId, q: "thought is:starred" }))).toEqual(["Second"])
		// Operators alone are no words.
		expect(titles(await listNotebook({ userId, q: "is:starred" }))).toEqual([])
	})

	it("narrows by tag, whatever its case, and offers the tags of noted articles", async () => {
		expect(titles(await listNotebook({ userId, tag: "BIRDS" }))).toEqual(["Second"])
		expect(titles(await listNotebook({ userId, tag: "birds", q: "first" }))).toEqual([])
		expect(titles(await listNotebook({ userId, tag: "gone" }))).toEqual([])
		expect(await notebookTags(userId)).toEqual([
			{ name: "alpha", notes: 1 },
			{ name: "Birds", notes: 1 },
		])
	})

	it("knows whether a reader has written any note", async () => {
		expect(await hasAnyNote(userId)).toBe(true)
		expect(await hasAnyNote(emptyId)).toBe(false)
		expect(await listNotebook({ userId: emptyId })).toEqual({ items: [], nextCursor: null })
	})
})
