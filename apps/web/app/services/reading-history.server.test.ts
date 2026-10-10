import { and, db, documents, eq, newId, readingCompletions, user } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
	openArticle,
	purgeArticles,
	saveReadingPosition,
	trashArticles,
	updateArticle,
	updateArticles,
} from "~/commands/articles.server"
import { restoreDocument } from "./documents.server"
import { buildDocumentExport, buildExport } from "./export.server"
import { listReadingHistory } from "./reading-history.server"

const userId = `test-history-${Date.now()}`
const otherId = `${userId}-other`
beforeAll(async () => {
	await db
		.insert(user)
		.values([userId, otherId].map((id) => ({ id, name: "Reader", email: `${id}@example.com` })))
})
afterAll(async () => {
	for (const id of [userId, otherId]) await db.delete(user).where(eq(user.id, id))
})
async function article(owner = userId) {
	const [doc] = await db
		.insert(documents)
		.values({
			userId: owner,
			sourceUrl: "https://example.com/history",
			urlHash: newId(),
			status: "ready",
		})
		.returning()
	return doc!
}
async function current(id: string) {
	return (await db.query.documents.findFirst({ where: eq(documents.id, id) }))!
}

describe("durable completion history", () => {
	it("records a manual finish once and preserves its date through retries and state resets", async () => {
		const doc = await article()
		await updateArticle(userId, doc.id, { finished: true })
		const first = await listReadingHistory(userId, doc.id)
		const readAt = (await current(doc.id)).readAt
		await updateArticle(userId, doc.id, { finished: true })
		expect((await current(doc.id)).readAt).toEqual(readAt)
		expect(await listReadingHistory(userId, doc.id)).toEqual(first)
		expect(first).toHaveLength(1)
		expect(first[0]?.source).toBe("manual")
		await updateArticle(userId, doc.id, { location: "inbox" })
		await updateArticle(userId, doc.id, { finished: false })
		expect((await current(doc.id)).readAt).toBeNull()
		expect(await listReadingHistory(userId, doc.id)).toEqual(first)
		await updateArticle(userId, doc.id, { finished: true })
		expect(await listReadingHistory(userId, doc.id)).toHaveLength(2)
	})

	it("records the threshold once across concurrent scroll saves and an explicit finish", async () => {
		const doc = await article()
		await saveReadingPosition(userId, doc.id, { position: 0.94, cycle: 0 })
		expect(await listReadingHistory(userId, doc.id)).toEqual([])
		await saveReadingPosition(userId, doc.id, { position: 0.95, cycle: 0 })
		const first = await listReadingHistory(userId, doc.id)
		expect(first).toHaveLength(1)
		expect(first[0]?.source).toBe("progress")
		expect(await current(doc.id)).toMatchObject({ readAt: null, archivedAt: null })
		await Promise.all([
			updateArticle(userId, doc.id, { finished: true }),
			...[0.96, 0.98, 1, 0.2].map((p) =>
				saveReadingPosition(userId, doc.id, { position: p, cycle: 0 }),
			),
		])
		expect(await listReadingHistory(userId, doc.id)).toEqual(first)
	})

	it("starts a new cycle on automatic rereading and ignores old tabs after a reset", async () => {
		const doc = await article()
		await openArticle(userId, doc.id)
		await saveReadingPosition(userId, doc.id, { position: 1, cycle: 0 })
		await db
			.update(documents)
			.set({ lastReadAt: new Date(Date.now() - 25 * 3_600_000) })
			.where(eq(documents.id, doc.id))
		const reopened = await openArticle(userId, doc.id)
		expect(reopened).toMatchObject({ readingCycle: 1, readingProgress: 0, readAt: null })
		await saveReadingPosition(userId, doc.id, { position: 1, cycle: 1 })
		expect(await listReadingHistory(userId, doc.id)).toHaveLength(2)
		await updateArticle(userId, doc.id, { finished: false })
		await saveReadingPosition(userId, doc.id, { position: 1, cycle: 1 })
		expect(await current(doc.id)).toMatchObject({
			readingCycle: 2,
			readingProgress: 0,
			firstOpenedAt: null,
			readAt: null,
		})
		expect(await listReadingHistory(userId, doc.id)).toHaveLength(2)
	})

	it("keeps histories private, retains trash history, and cascades permanent deletion", async () => {
		const doc = await article()
		await updateArticles(otherId, { ids: [doc.id], finished: true })
		await expect(saveReadingPosition(otherId, doc.id, { position: 1 })).rejects.toMatchObject({
			code: "not_found",
		})
		expect(await listReadingHistory(userId, doc.id)).toEqual([])
		await updateArticle(userId, doc.id, { finished: true })
		expect(await listReadingHistory(otherId, doc.id)).toEqual([])
		await trashArticles(userId, [doc.id])
		expect(await listReadingHistory(userId, doc.id)).toEqual([])
		expect(
			await db.select().from(readingCompletions).where(eq(readingCompletions.documentId, doc.id)),
		).toHaveLength(1)
		await restoreDocument(userId, doc.id)
		expect(await listReadingHistory(userId, doc.id)).toHaveLength(1)
		await trashArticles(userId, [doc.id])
		await purgeArticles(userId, [doc.id])
		expect(
			await db.select().from(readingCompletions).where(eq(readingCompletions.documentId, doc.id)),
		).toHaveLength(0)
	})

	it("exports past completions independently of current finished state", async () => {
		const doc = await article()
		await updateArticle(userId, doc.id, { finished: true })
		await updateArticle(userId, doc.id, { finished: false })
		const history = await listReadingHistory(userId, doc.id)
		const exported = await buildDocumentExport(userId, doc.id)
		expect(exported).toMatchObject({
			finishedAt: null,
			readingHistory: [{ completedAt: history[0]!.completedAt.toISOString(), source: "manual" }],
		})
		const bundle = await buildExport(userId)
		expect(bundle.documents.find((d) => d.id === doc.id)?.readingHistory).toEqual(
			exported!.readingHistory,
		)
		expect(await buildDocumentExport(otherId, doc.id)).toBeNull()
	})

	it("deletes history with its account", async () => {
		const doc = await article(otherId)
		await updateArticle(otherId, doc.id, { finished: true })
		await db.delete(user).where(eq(user.id, otherId))
		expect(
			await db
				.select()
				.from(readingCompletions)
				.where(
					and(eq(readingCompletions.userId, otherId), eq(readingCompletions.documentId, doc.id)),
				),
		).toEqual([])
	})
})
