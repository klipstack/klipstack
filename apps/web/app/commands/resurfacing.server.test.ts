import { db, documents, documentVersions, eq, highlights, user as userTable } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { deleteHighlight } from "./annotations.server"
import { trashArticles } from "./articles.server"
import { dailyHighlights, resumeResurfacing, stopResurfacing } from "./resurfacing.server"

const run = `test-resurfacing-cmd-${Date.now()}`
const [userId, otherId] = [`${run}-a`, `${run}-b`]
const DAY = "2026-10-13"

/** A ready article with one highlight, a month old. */
async function highlighted(owner = userId) {
	const [doc] = await db
		.insert(documents)
		.values({
			userId: owner,
			sourceUrl: `https://example.com/${Math.random()}`,
			urlHash: `${owner}-${Math.random()}`,
			status: "ready",
		})
		.returning({ id: documents.id })
	const [version] = await db
		.insert(documentVersions)
		.values({
			documentId: doc!.id,
			version: 1,
			html: "<p>Text</p>",
			text: "Text",
			textHash: `${Math.random()}`,
			extractor: "test",
			extractorVersion: "0",
		})
		.returning({ id: documentVersions.id })
	const [h] = await db
		.insert(highlights)
		.values({
			userId: owner,
			documentId: doc!.id,
			versionId: version!.id,
			startOffset: 0,
			endOffset: 4,
			exact: "Text",
			note: "Why it mattered",
			createdAt: new Date("2026-09-01T12:00:00Z"),
		})
		.returning({ id: highlights.id })
	return { documentId: doc!.id, id: h!.id }
}

beforeAll(async () => {
	for (const id of [userId, otherId])
		await db.insert(userTable).values({ id, name: id, email: `${id}@example.com` })
})

afterAll(async () => {
	for (const id of [userId, otherId]) await db.delete(userTable).where(eq(userTable.id, id))
})

describe("dailyHighlights", () => {
	it("refuses what is not a day", async () => {
		for (const day of ["13/10/2026", "2026-13-40", "2026-02-30", ""])
			await expect(dailyHighlights(userId, day)).rejects.toMatchObject({ code: "invalid_request" })
	})
})

describe("stopResurfacing", () => {
	it("stops a highlight coming back without touching it, and resumeResurfacing undoes it", async () => {
		const h = await highlighted()
		expect((await dailyHighlights(userId, DAY)).map((x) => x.id)).toEqual([h.id])
		await stopResurfacing(userId, h.id)
		expect(await dailyHighlights(userId, DAY)).toEqual([])
		const [row] = await db.select().from(highlights).where(eq(highlights.id, h.id))
		expect(row).toMatchObject({ note: "Why it mattered", deletedAt: null })
		// Again is no error.
		await stopResurfacing(userId, h.id)
		await resumeResurfacing(userId, h.id)
		expect((await dailyHighlights(userId, DAY)).map((x) => x.id)).toEqual([h.id])
	})

	it("is not_found for someone else's, a deleted one, or one in a trashed article", async () => {
		const foreign = await highlighted(otherId)
		const deleted = await highlighted()
		await deleteHighlight(userId, deleted.id)
		const trashed = await highlighted()
		await trashArticles(userId, [trashed.documentId])
		for (const id of [foreign.id, deleted.id, trashed.id]) {
			await expect(stopResurfacing(userId, id)).rejects.toMatchObject({ code: "not_found" })
			await expect(resumeResurfacing(userId, id)).rejects.toMatchObject({ code: "not_found" })
		}
		await expect(stopResurfacing(userId, "nope")).rejects.toMatchObject({
			code: "invalid_request",
		})
		// The other reader's highlight still comes back to them.
		expect((await dailyHighlights(otherId, DAY)).map((x) => x.id)).toEqual([foreign.id])
	})
})
