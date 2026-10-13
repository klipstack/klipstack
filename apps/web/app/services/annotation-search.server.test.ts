import { createHash } from "node:crypto"
import {
	db,
	documents,
	documentVersions,
	eq,
	highlights,
	sql,
	textSearchVector,
	user as userTable,
} from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
	createHighlight,
	deleteHighlight,
	resizeHighlight,
	restoreHighlight,
	setArticleNote,
	updateHighlight,
} from "~/commands/annotations.server"
import { trashArticles } from "~/commands/articles.server"
import { snippetText } from "~/lib/search-snippet"
import { quickFindAnnotations, searchHighlights, searchNotes } from "./annotation-search.server"
import { getDocument } from "./documents.server"
import { getHighlight, listDocumentHighlights, listUserHighlights } from "./highlights.server"
import { searchDocuments } from "./search.server"

const tag = `test-annsearch-${Date.now()}`
const userId = `${tag}-a`
const otherId = `${tag}-b`

/** A ready article whose text is `text`. */
async function article(
	owner: string,
	text: string,
	fields: { title?: string; language?: string | null; siteName?: string } = {},
) {
	const [doc] = await db
		.insert(documents)
		.values({
			userId: owner,
			sourceUrl: `https://example.com/${tag}/${Math.random()}`,
			urlHash: `${tag}-${Math.random()}`,
			status: "ready",
			title: fields.title ?? "Untitled",
			language: fields.language ?? null,
			siteName: fields.siteName ?? null,
		})
		.returning({ id: documents.id })
	const [version] = await db
		.insert(documentVersions)
		.values({
			documentId: doc!.id,
			version: 1,
			html: `<p>${text}</p>`,
			text,
			textHash: createHash("sha256").update(text).digest("hex"),
			extractor: "test",
			extractorVersion: "0",
		})
		.returning({ id: documentVersions.id })
	await db.update(documents).set({ currentVersionId: version!.id }).where(eq(documents.id, doc!.id))
	return { id: doc!.id, versionId: version!.id, text }
}

const quotes = (group: { items: Array<{ quote: Array<{ text: string }> }> }) =>
	group.items.map((h) => snippetText(h.quote))
const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id)

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

describe("the stored vectors", () => {
	it("are built in SQL as textSearchVector builds them in TypeScript", async () => {
		const text = "La decisión fue difícil: blocked roads, Häuser and naïve ideas"
		for (const language of ["en", "es", "pt", "fr", "it", "de", "nl", null]) {
			const [row] = await db
				.execute<{ same: boolean }>(
					sql`select search_part(${text}, ${language}::text) = ${textSearchVector(sql`${text}::text`, sql`${language}::text`)} as same`,
				)
				.then((r) => r.rows)
			expect(row?.same, String(language)).toBe(true)
		}
	})
})

describe("the vectors stay on the server", () => {
	it("are left out of the highlights and articles that reads and commands return", async () => {
		const a = await article(userId, "Vectors are long and private.")
		const created = await createHighlight(userId, a.id, { exact: "Vectors are long" })
		const updated = await updateHighlight(userId, created.id, { note: "kept apart" })
		await setArticleNote(userId, a.id, { note: "A note with words" })
		for (const row of [
			created,
			updated,
			await getHighlight(userId, created.id),
			...(await listDocumentHighlights(userId, a.id)),
		])
			expect(Object.keys(row ?? {})).not.toContain("search")
		const doc = await getDocument(userId, a.id)
		expect(doc?.note).toBe("A note with words")
		expect(Object.keys(doc ?? {})).not.toContain("noteSearch")
		expect(Object.keys(doc ?? {})).not.toContain("search")
	})
})

describe("searchHighlights", () => {
	it("finds a highlight by its quote or note: variants and accents aside, words marked", async () => {
		const a = await article(userId, "The roads were blocked for a week. La decisión fue difícil.", {
			title: "Winter notes",
			language: "en",
		})
		const roads = await createHighlight(userId, a.id, { exact: "The roads were blocked" })
		const decision = await createHighlight(userId, a.id, {
			exact: "La decisión fue difícil.",
			note: "A compass for hard calls",
		})

		const blocking = await searchHighlights({ userId, q: "blocking" })
		expect(ids(blocking.items)).toEqual([roads.id])
		expect(blocking.items[0]!.quote).toEqual([
			{ text: "The roads were " },
			{ text: "blocked", match: true },
		])
		expect(blocking.items[0]).toMatchObject({ documentId: a.id, title: "Winter notes" })

		const accents = await searchHighlights({ userId, q: "decision" })
		expect(ids(accents.items)).toEqual([decision.id])
		expect(accents.items[0]!.quote[1]).toEqual({ text: "decisión", match: true })

		const byNote = await searchHighlights({ userId, q: "compass" })
		expect(ids(byNote.items)).toEqual([decision.id])
		expect(byNote.items[0]!.note).toEqual([
			{ text: "A " },
			{ text: "compass", match: true },
			{ text: " for hard calls" },
		])

		// Every word must match; the article's title alone does not count.
		expect((await searchHighlights({ userId, q: "roads compass" })).items).toEqual([])
		expect((await searchHighlights({ userId, q: "winter" })).items).toEqual([])
	})

	it("never shows another user's, a deleted one or one of an article in the trash", async () => {
		const mine = await article(userId, "Quokka sightings near the river.")
		const theirs = await article(otherId, "Quokka sightings near the river.")
		const kept = await createHighlight(userId, mine.id, { exact: "Quokka sightings" })
		const deleted = await createHighlight(userId, mine.id, { exact: "near the river" })
		await createHighlight(otherId, theirs.id, { exact: "Quokka sightings" })
		await deleteHighlight(userId, deleted.id)
		expect(ids((await searchHighlights({ userId, q: "quokka" })).items)).toEqual([kept.id])
		expect((await searchHighlights({ userId, q: "river" })).items).toEqual([])

		await trashArticles(userId, [mine.id])
		expect((await searchHighlights({ userId, q: "quokka" })).items).toEqual([])
		expect((await searchHighlights({ userId, q: "quokka in:trash" })).items).toEqual([])
		expect(await quickFindAnnotations({ userId, q: "quok" })).toEqual({ highlights: [], notes: [] })
	})

	it("applies the query's operators to the highlight's article", async () => {
		const starred = await article(userId, "Zeppelin routes over the bay.", { siteName: "Airships" })
		const plain = await article(userId, "Zeppelin routes over the hills.")
		await db.update(documents).set({ starredAt: new Date() }).where(eq(documents.id, starred.id))
		await createHighlight(userId, starred.id, { exact: "Zeppelin routes over the bay." })
		await createHighlight(userId, plain.id, { exact: "Zeppelin routes over the hills." })

		expect(quotes(await searchHighlights({ userId, q: "zeppelin is:starred" }))).toEqual([
			"Zeppelin routes over the bay.",
		])
		expect(quotes(await searchHighlights({ userId, q: "zeppelin -is:starred" }))).toEqual([
			"Zeppelin routes over the hills.",
		])
		expect(quotes(await searchHighlights({ userId, q: '"over the hills"' }))).toEqual([
			"Zeppelin routes over the hills.",
		])
		// Operators without words find no highlights.
		expect(await searchHighlights({ userId, q: "is:starred" })).toEqual({ items: [], total: 0 })
	})

	it("counts every match and shows the first page", async () => {
		const a = await article(userId, "Ocelot one. Ocelot two. Ocelot three.")
		for (const exact of ["Ocelot one.", "Ocelot two.", "Ocelot three."])
			await createHighlight(userId, a.id, { exact })
		const page = await searchHighlights({ userId, q: "ocelot", limit: 2 })
		expect(page.items).toHaveLength(2)
		expect(page.total).toBe(3)
	})
})

describe("the highlight vector stays current", () => {
	it("follows a note change, a resize, a delete and its undo", async () => {
		const a = await article(userId, "Marmalade skies over tangerine trees.", { language: "en" })
		const h = await createHighlight(userId, a.id, { exact: "Marmalade skies" })
		const found = async (q: string) => ids((await searchHighlights({ userId, q })).items)

		await updateHighlight(userId, h.id, { note: "Lucy wrote this" })
		expect(await found("lucy")).toEqual([h.id])
		await updateHighlight(userId, h.id, { note: "Rewritten" })
		expect(await found("lucy")).toEqual([])
		expect(await found("rewritten")).toEqual([h.id])

		await resizeHighlight(userId, a.id, {
			id: h.id,
			versionId: a.versionId,
			previous: { start: 0, end: 15, exact: "Marmalade skies" },
			selector: { start: 0, end: 36, exact: a.text.slice(0, 36), prefix: "", suffix: "." },
		})
		expect(await found("tangerine")).toEqual([h.id])

		await deleteHighlight(userId, h.id)
		expect(await found("tangerine")).toEqual([])
		await restoreHighlight(userId, h.id)
		expect(await found("tangerine")).toEqual([h.id])
	})

	it("follows the article's title, author and site for the highlights page", async () => {
		const a = await article(userId, "Plain words only here.", { title: "Old title" })
		const h = await createHighlight(userId, a.id, { exact: "Plain words" })
		const listed = async (q: string) => ids((await listUserHighlights({ userId, q })).items)
		expect(await listed("old")).toEqual([h.id])
		await db
			.update(documents)
			.set({ title: "Pelican briefing", author: "Grisham", siteName: "Bookshelf" })
			.where(eq(documents.id, a.id))
		expect(await listed("old")).toEqual([])
		expect(await listed("pelican")).toEqual([h.id])
		expect(await listed("grisham plain")).toEqual([h.id])
		expect(await listed("bookshelf")).toEqual([h.id])
	})

	it("matches on the highlights page as typed: word starts, variants, exact phrases", async () => {
		const a = await article(userId, "Scheduling conflicts were resolved quickly.", {
			language: "en",
		})
		const h = await createHighlight(userId, a.id, { exact: "Scheduling conflicts were resolved" })
		const listed = async (q: string) => ids((await listUserHighlights({ userId, q })).items)
		expect(await listed("sched")).toEqual([h.id])
		expect(await listed("schedule conflict")).toEqual([h.id])
		expect(await listed('"conflicts were"')).toEqual([h.id])
		expect(await listed('"conflict were"')).toEqual([])
		expect(await listed("resolved -")).toEqual([h.id])
	})

	it("is filled for highlights written straight to the table", async () => {
		const a = await article(userId, "Direct insert of a narwhal passage.")
		const [row] = await db
			.insert(highlights)
			.values({
				documentId: a.id,
				userId,
				versionId: a.versionId,
				startOffset: 0,
				endOffset: 35,
				exact: "Direct insert of a narwhal passage.",
			})
			.returning({ id: highlights.id })
		expect(ids((await searchHighlights({ userId, q: "narwhal" })).items)).toEqual([row!.id])
	})
})

describe("searchNotes", () => {
	it("finds an article note by its words, follows changes, and keeps out the trash", async () => {
		const a = await article(userId, "Body text.", { title: "Field guide" })
		const filler = "Some long preamble that goes on. ".repeat(20)
		await setArticleNote(userId, a.id, { note: `${filler}The armadillo hypothesis holds.` })

		const found = await searchNotes({ userId, q: "armadillos" })
		expect(found.total).toBe(1)
		expect(found.items[0]).toMatchObject({ documentId: a.id, title: "Field guide" })
		// Around the match, not the start of the note.
		expect(found.items[0]!.note).toEqual([
			{ text: "…goes on. Some long preamble that goes on. The " },
			{ text: "armadillo", match: true },
			{ text: " hypothesis holds." },
		])

		// The article itself is found by its note, as before.
		expect((await searchDocuments({ userId, q: "armadillo" })).items.map((d) => d.id)).toEqual([
			a.id,
		])

		await setArticleNote(userId, a.id, { note: "Now about pangolins" })
		expect((await searchNotes({ userId, q: "armadillo" })).items).toEqual([])
		expect((await searchNotes({ userId, q: "pangolin" })).total).toBe(1)
		await setArticleNote(userId, a.id, { note: null })
		expect((await searchNotes({ userId, q: "pangolin" })).items).toEqual([])

		await setArticleNote(userId, a.id, { note: "Capybara census" })
		await trashArticles(userId, [a.id])
		expect((await searchNotes({ userId, q: "capybara" })).items).toEqual([])
		expect((await searchNotes({ userId, q: "capybara in:trash" })).items).toEqual([])
	})

	it("never shows another user's note", async () => {
		const theirs = await article(otherId, "Body.")
		await setArticleNote(otherId, theirs.id, { note: "Wombat secrets" })
		expect((await searchNotes({ userId, q: "wombat" })).items).toEqual([])
		expect((await quickFindAnnotations({ userId, q: "wombat" })).notes).toEqual([])
		expect((await searchNotes({ userId: otherId, q: "wombat" })).total).toBe(1)
	})
})

describe("quickFindAnnotations", () => {
	it("finds highlights and notes by the start of their words", async () => {
		const a = await article(userId, "Hummingbird migration patterns are astonishing.", {
			title: "Tanager",
		})
		const h = await createHighlight(userId, a.id, { exact: "Hummingbird migration patterns" })
		await setArticleNote(userId, a.id, { note: "Remember the hummingbirds of Oaxaca" })

		const found = await quickFindAnnotations({ userId, q: "humming migr" })
		expect(found.highlights).toEqual([
			{ id: h.id, documentId: a.id, title: "Tanager", quote: "Hummingbird migration patterns" },
		])
		expect(found.notes).toEqual([])

		const notes = await quickFindAnnotations({ userId, q: "oaxa" })
		expect(notes.notes).toEqual([
			{ documentId: a.id, title: "Tanager", note: "Remember the hummingbirds of Oaxaca" },
		])
		// The article's title is the article's result, not its highlights'.
		expect((await quickFindAnnotations({ userId, q: "tanager" })).highlights).toEqual([])
		expect(await quickFindAnnotations({ userId, q: " ?! " })).toEqual({ highlights: [], notes: [] })
	})
})
