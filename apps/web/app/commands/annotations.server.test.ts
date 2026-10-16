import { createHash } from "node:crypto"
import { NOTE_MAX } from "@klipstack/api-contract"
import { db, documents, documentVersions, eq, highlights, user as userTable } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { appOrigin } from "~/services/article-summary.server"
import { setNote } from "~/services/documents.server"
import {
	appendArticleNote,
	createHighlight,
	deleteHighlight,
	restoreHighlight,
	setArticleNote,
	updateHighlight,
} from "./annotations.server"
import { trashArticles } from "./articles.server"

const userId = `test-annotations-${Date.now()}`
const TEXT =
	"Alpha bravo charlie delta echo. Foxtrot charlie delta golf. Hotel **india** juliett kilo."

/** A ready article whose text is `text`. */
async function article(text = TEXT) {
	const [doc] = await db
		.insert(documents)
		.values({
			userId,
			sourceUrl: `https://example.com/annotations/${Math.random()}`,
			urlHash: `${userId}-${Math.random()}`,
			status: "ready",
		})
		.returning({ id: documents.id })
	const [version] = await db
		.insert(documentVersions)
		.values({
			documentId: doc!.id,
			version: 1,
			html: `<p>${text}</p>`,
			text: text.replaceAll("**", ""),
			textHash: createHash("sha256").update(text).digest("hex"),
			extractor: "test",
			extractorVersion: "0",
		})
		.returning({ id: documentVersions.id })
	await db.update(documents).set({ currentVersionId: version!.id }).where(eq(documents.id, doc!.id))
	return doc!.id
}

beforeAll(async () => {
	await db.insert(userTable).values({ id: userId, name: "Notes", email: `${userId}@example.com` })
})

afterAll(async () => {
	await db.delete(userTable).where(eq(userTable.id, userId))
})

describe("createHighlight", () => {
	it("asks which occurrence when a passage appears twice, and takes the one named", async () => {
		const id = await article()
		const refused = await createHighlight(userId, id, { exact: "charlie delta" }).catch(
			(e: unknown) => e,
		)
		expect(refused).toMatchObject({ code: "ambiguous_quote", status: 409 })
		const { candidates } = (refused as { details: { candidates: unknown[] } }).details
		expect(candidates).toEqual([
			expect.objectContaining({
				occurrence: 1,
				context: expect.stringContaining("[charlie delta]"),
			}),
			expect.objectContaining({ occurrence: 2 }),
		])
		const second = await createHighlight(userId, id, { exact: "charlie delta", occurrence: 2 })
		expect(TEXT.replaceAll("**", "").slice(second.startOffset, second.endOffset)).toBe(
			"charlie delta",
		)
		expect(second.startOffset).toBeGreaterThan(TEXT.indexOf("Foxtrot"))
		await expect(
			createHighlight(userId, id, { exact: "charlie delta", occurrence: 3 }),
		).rejects.toMatchObject({ code: "ambiguous_quote", message: /only 2 occurrences/ })
	})

	it("reads a quote without its Markdown, stores note links, and refuses what is not there", async () => {
		const id = await article()
		const other = await article()
		const h = await createHighlight(userId, id, {
			exact: "Hotel **india** juliett",
			note: `See [the other](${appOrigin}/read/${other})`,
			color: 2,
		})
		expect(h).toMatchObject({ exact: "Hotel india juliett", color: 2 })
		expect(h.note).toBe(`See [the other](/read/${other})`)
		await expect(createHighlight(userId, id, { exact: "zulu yankee" })).rejects.toMatchObject({
			code: "no_match",
		})
		await expect(createHighlight(userId, id, { exact: "  " })).rejects.toMatchObject({
			code: "invalid_request",
		})
		await expect(createHighlight(userId, id, { exact: "Alpha", color: 9 })).rejects.toMatchObject({
			code: "invalid_request",
		})
	})
})

describe("changing a highlight", () => {
	it("is refused once its article is in the trash, and a delete keeps its first time", async () => {
		const id = await article()
		const h = await createHighlight(userId, id, { exact: "Alpha bravo" })
		expect(await updateHighlight(userId, h.id, { color: 4 })).toMatchObject({ color: 4 })
		await expect(updateHighlight(userId, h.id, {})).rejects.toMatchObject({
			code: "invalid_request",
		})
		await deleteHighlight(userId, h.id)
		const [deleted] = await db.select().from(highlights).where(eq(highlights.id, h.id))
		await expect(deleteHighlight(userId, h.id)).rejects.toMatchObject({ code: "not_found" })
		const [still] = await db.select().from(highlights).where(eq(highlights.id, h.id))
		expect(still!.deletedAt).toEqual(deleted!.deletedAt)
		await restoreHighlight(userId, h.id)
		await expect(restoreHighlight(userId, h.id)).rejects.toMatchObject({ code: "not_found" })
		// Deleted, then its article trashed: it stays deleted.
		const gone = await createHighlight(userId, id, { exact: "Foxtrot" })
		await deleteHighlight(userId, gone.id)

		await trashArticles(userId, [id])
		await expect(updateHighlight(userId, h.id, { note: "x" })).rejects.toMatchObject({
			code: "not_found",
		})
		await expect(deleteHighlight(userId, h.id)).rejects.toMatchObject({ code: "not_found" })
		await expect(restoreHighlight(userId, gone.id)).rejects.toMatchObject({ code: "not_found" })
		const [kept] = await db.select().from(highlights).where(eq(highlights.id, gone.id))
		expect(kept!.deletedAt).not.toBeNull()
	})
})

describe("the article note", () => {
	it("writes only over the note the writer read, and says what is there instead", async () => {
		const id = await article()
		const first = await setArticleNote(userId, id, { note: "One", expectedUpdatedAt: null })
		await expect(
			setArticleNote(userId, id, { note: "Two", expectedUpdatedAt: null }),
		).rejects.toMatchObject({
			code: "note_changed",
			details: { note: "One", noteUpdatedAt: first.noteUpdatedAt!.toISOString() },
		})
		const second = await setArticleNote(userId, id, {
			note: "Two",
			expectedUpdatedAt: first.noteUpdatedAt!.toISOString(),
		})
		expect(second.note).toBe("Two")
	})

	it("adds paragraphs, and never loses one to a write in between", async () => {
		const id = await article()
		expect(await appendArticleNote(userId, id, "First.")).toMatchObject({ note: "First." })
		const results = await Promise.allSettled(
			["A.", "B.", "C.", "D."].map((p) => appendArticleNote(userId, id, p)),
		)
		const { note } = (await db.query.documents.findFirst({ where: eq(documents.id, id) }))!
		results.forEach((result, i) => {
			// Each one is in the note, or its caller was told the note kept changing.
			if (result.status === "fulfilled") expect(note).toContain(["A.", "B.", "C.", "D."][i])
			else expect(result.reason).toMatchObject({ code: "note_changed" })
		})
		expect(note?.startsWith("First.")).toBe(true)
	})

	it("refuses a paragraph that would make the note too long, or an empty one", async () => {
		const id = await article()
		await setNote(userId, id, "x".repeat(NOTE_MAX - 1))
		await expect(appendArticleNote(userId, id, "more")).rejects.toMatchObject({
			code: "note_too_long",
			details: { length: NOTE_MAX + 5 },
		})
		await expect(appendArticleNote(userId, id, "   ")).rejects.toMatchObject({
			code: "invalid_request",
		})
	})
})
