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
import { finishedLately, listReadingHistory } from "./reading-history.server"

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
async function article(owner = userId, title: string | null = null) {
	const [doc] = await db
		.insert(documents)
		.values({
			userId: owner,
			title,
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

describe("finishes recorded as one batch", () => {
	it("records finishing several articles at once as bulk, and one article as manual", async () => {
		const [a, b, c] = [await article(), await article(), await article()]
		await updateArticles(userId, { ids: [a.id, b.id], finished: true })
		await updateArticles(userId, { ids: [c.id], finished: true })
		expect((await listReadingHistory(userId, a.id)).map((e) => e.source)).toEqual(["bulk"])
		expect((await listReadingHistory(userId, b.id)).map((e) => e.source)).toEqual(["bulk"])
		expect((await listReadingHistory(userId, c.id)).map((e) => e.source)).toEqual(["manual"])
	})
})

describe("finishedLately", () => {
	// Sunday 11 October 2026, 09:00 in Santiago (UTC-3).
	const now = new Date("2026-10-11T12:00:00Z")
	async function reader() {
		const id = `test-lately-${newId()}`
		await db.insert(user).values({ id, name: "Reader", email: `${id}@example.com` })
		readers.push(id)
		return id
	}
	const readers: string[] = []
	afterAll(async () => {
		for (const id of readers) await db.delete(user).where(eq(user.id, id))
	})
	async function finished(
		owner: string,
		documentId: string,
		completedAt: string,
		source: "manual" | "progress" | "legacy" | "bulk" = "manual",
		cycle = 0,
	) {
		await db
			.insert(readingCompletions)
			.values({ userId: owner, documentId, cycle, completedAt: new Date(completedAt), source })
	}

	it("says nothing when nothing was finished in the past week", async () => {
		const owner = await reader()
		const doc = await article(owner, "Long ago")
		await finished(owner, doc.id, "2026-09-20T10:00:00Z")
		expect(await finishedLately(owner, { now, timeZone: "UTC" })).toBeNull()
	})

	it("names the one article finished", async () => {
		const owner = await reader()
		const doc = await article(owner, "How to Read a Book")
		await finished(owner, doc.id, "2026-10-10T18:00:00Z", "progress")
		expect(await finishedLately(owner, { now, timeZone: "UTC" })).toEqual({
			count: 1,
			title: "How to Read a Book",
		})
	})

	it("counts articles finished by hand, by reading to the end, and before the history existed", async () => {
		const owner = await reader()
		const [a, b, c] = [await article(owner), await article(owner), await article(owner)]
		await finished(owner, a.id, "2026-10-06T10:00:00Z", "manual")
		await finished(owner, b.id, "2026-10-08T10:00:00Z", "progress")
		await finished(owner, c.id, "2026-10-11T11:00:00Z", "legacy")
		expect(await finishedLately(owner, { now, timeZone: "UTC" })).toEqual({ count: 3, title: null })
	})

	it("counts an article read twice in the week once, and a reread of an old one", async () => {
		const owner = await reader()
		const [twice, old, other] = [await article(owner), await article(owner), await article(owner)]
		await finished(owner, twice.id, "2026-10-06T10:00:00Z", "manual", 0)
		await finished(owner, twice.id, "2026-10-09T10:00:00Z", "progress", 1)
		await finished(owner, old.id, "2026-03-01T10:00:00Z", "manual", 0)
		await finished(owner, old.id, "2026-10-10T10:00:00Z", "progress", 1)
		await finished(owner, other.id, "2026-10-10T11:00:00Z")
		expect(await finishedLately(owner, { now, timeZone: "UTC" })).toEqual({ count: 3, title: null })
	})

	it("leaves out bulk finishes, trashed articles and other readers' articles", async () => {
		const owner = await reader()
		const someone = await reader()
		const [read, tidied, trashed] = [
			await article(owner, "Read"),
			await article(owner, "Tidied"),
			await article(owner, "Trashed"),
		]
		const theirs = await article(someone, "Theirs")
		await finished(owner, read.id, "2026-10-09T10:00:00Z")
		await finished(owner, tidied.id, "2026-10-09T10:00:00Z", "bulk")
		await finished(owner, trashed.id, "2026-10-09T10:00:00Z")
		await db.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, trashed.id))
		await finished(someone, theirs.id, "2026-10-09T10:00:00Z")
		expect(await finishedLately(owner, { now, timeZone: "UTC" })).toEqual({
			count: 1,
			title: "Read",
		})
	})

	it("covers today and the 6 days before, as days in the reader's time zone", async () => {
		const owner = await reader()
		const [first, before] = [await article(owner, "First day"), await article(owner, "Before")]
		// Monday 5 October, 00:30 in Santiago: the first day of the week before Sunday the 11th.
		await finished(owner, first.id, "2026-10-05T03:30:00Z")
		// Sunday 4 October, 23:30 in Santiago, but already Monday the 5th in UTC.
		await finished(owner, before.id, "2026-10-05T02:30:00Z")
		expect(await finishedLately(owner, { now, timeZone: "America/Santiago" })).toEqual({
			count: 1,
			title: "First day",
		})
		expect(await finishedLately(owner, { now, timeZone: "UTC" })).toEqual({
			count: 2,
			title: null,
		})
	})
})
