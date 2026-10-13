import { db, documents, eq, user as userTable } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { setArticleNote } from "~/commands/annotations.server"
import { trashArticles, updateArticles } from "~/commands/articles.server"
import { hasAnyNote, listNotebook, notebookTags } from "./notebook.server"

const tag = `test-notebook-${Date.now()}`
const userId = `${tag}-a`
const otherId = `${tag}-b`

async function article(owner: string, title: string, fields: { leadImageUrl?: string } = {}) {
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

beforeAll(async () => {
	await db.insert(userTable).values([
		{ id: userId, name: "A", email: `${userId}@example.com` },
		{ id: otherId, name: "B", email: `${otherId}@example.com` },
	])
})

afterAll(async () => {
	await db.delete(userTable).where(eq(userTable.id, userId))
	await db.delete(userTable).where(eq(userTable.id, otherId))
})

describe("the notebook", () => {
	it("lists every note, most recently edited first, with its article and tags", async () => {
		expect(await hasAnyNote(userId)).toBe(false)
		const first = await article(userId, "First", { leadImageUrl: "https://img.example/1.jpg" })
		const second = await article(userId, "Second")
		const third = await article(userId, "Third")
		await article(userId, "Without a note")
		const foreign = await article(otherId, "Not mine")
		await setArticleNote(otherId, foreign, { note: "Someone else's thoughts" })
		await setArticleNote(userId, first, { note: "Thoughts on the first" })
		await setArticleNote(userId, second, { note: "Thoughts on the second" })
		await setArticleNote(userId, third, { note: "Thoughts on the third" })
		await updateArticles(userId, { ids: [second], addTags: ["Birds", "alpha"] })
		// Editing the first moves it to the top.
		await setArticleNote(userId, first, { note: "Thoughts on the first, revised" })

		const page = await listNotebook({ userId })
		expect(titles(page)).toEqual(["First", "Third", "Second"])
		expect(page.items[0]).toMatchObject({
			documentId: first,
			siteName: "Example",
			image: "https://img.example/1.jpg",
			note: "Thoughts on the first, revised",
			tags: [],
		})
		expect(page.items[0]!.noteUpdatedAt).toBeInstanceOf(Date)
		expect(page.items[2]!.tags).toEqual(["alpha", "Birds"])
		expect(page.nextCursor).toBeNull()
		expect(await hasAnyNote(userId)).toBe(true)
	})

	it("pages without overlap", async () => {
		const page1 = await listNotebook({ userId, limit: 2 })
		expect(titles(page1)).toEqual(["First", "Third"])
		const page2 = await listNotebook({ userId, limit: 2, cursor: page1.nextCursor })
		expect(titles(page2)).toEqual(["Second"])
		expect(page2.nextCursor).toBeNull()
	})

	it("finds notes by their words, as the search page does, and narrows by tag", async () => {
		expect(titles(await listNotebook({ userId, q: "revised" }))).toEqual(["First"])
		expect(titles(await listNotebook({ userId, q: "thought" }))).toEqual([
			"First",
			"Third",
			"Second",
		])
		// The article's title is not the note.
		expect(titles(await listNotebook({ userId, q: "Without" }))).toEqual([])
		// Operators alone are no words.
		expect(titles(await listNotebook({ userId, q: "is:starred" }))).toEqual([])
		expect(titles(await listNotebook({ userId, tag: "BIRDS" }))).toEqual(["Second"])
		expect(titles(await listNotebook({ userId, tag: "birds", q: "first" }))).toEqual([])
		expect(await notebookTags(userId)).toEqual([
			{ name: "alpha", notes: 1 },
			{ name: "Birds", notes: 1 },
		])
	})

	it("leaves out cleared notes and articles in the trash", async () => {
		const [third, second] = (await listNotebook({ userId })).items.slice(1).map((n) => n.documentId)
		await setArticleNote(userId, third!, { note: "  " })
		await trashArticles(userId, [second!])
		expect(titles(await listNotebook({ userId }))).toEqual(["First"])
		expect(await notebookTags(userId)).toEqual([])
	})
})
