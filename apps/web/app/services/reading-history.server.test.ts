import {
	and,
	db,
	documents,
	documentTopics,
	eq,
	newId,
	readingCompletions,
	topics,
	user,
} from "@klipstack/db"
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
import { finishedLately, listReadingHistory, readingStats } from "./reading-history.server"

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

	it("records one article finished as manual, even selected with others already finished", async () => {
		const [done, fresh] = [await article(), await article()]
		await updateArticle(userId, done.id, { finished: true })
		await updateArticles(userId, { ids: [done.id, fresh.id], finished: true })
		expect((await listReadingHistory(userId, fresh.id)).map((e) => e.source)).toEqual(["manual"])
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
		source: "manual" | "progress" | "legacy" | "bulk" | "listened" = "manual",
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

	it("counts articles finished by hand, by reading or listening to the end, and before the history existed", async () => {
		const owner = await reader()
		const [a, b, c, d] = [
			await article(owner),
			await article(owner),
			await article(owner),
			await article(owner),
		]
		await finished(owner, a.id, "2026-10-06T10:00:00Z", "manual")
		await finished(owner, b.id, "2026-10-08T10:00:00Z", "progress")
		await finished(owner, c.id, "2026-10-11T11:00:00Z", "legacy")
		await finished(owner, d.id, "2026-10-11T12:00:00Z", "listened")
		expect(await finishedLately(owner, { now, timeZone: "UTC" })).toEqual({ count: 4, title: null })
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

	it("counts by UTC days when the database doesn't know the reader's zone", async () => {
		const owner = await reader()
		const doc = await article(owner, "Read anyway")
		await finished(owner, doc.id, "2026-10-09T10:00:00Z")
		// The browser's zone names can be newer than the database's: Home loads all the same.
		expect(await finishedLately(owner, { now, timeZone: "Mars/Olympus_Mons" })).toEqual({
			count: 1,
			title: "Read anyway",
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

describe("readingStats", () => {
	// Saturday 31 October 2026, noon in Santiago (UTC-3).
	const now = new Date("2026-10-31T15:00:00Z")
	const timeZone = "America/Santiago"
	const readers: string[] = []
	afterAll(async () => {
		for (const id of readers) await db.delete(user).where(eq(user.id, id))
	})
	async function reader() {
		const id = `test-stats-${newId()}`
		await db.insert(user).values({ id, name: "Reader", email: `${id}@example.com` })
		readers.push(id)
		return id
	}
	async function read(owner: string, title: string, wordCount: number | null) {
		const [doc] = await db
			.insert(documents)
			.values({
				userId: owner,
				title,
				sourceUrl: "https://example.com/stats",
				urlHash: newId(),
				status: "ready",
				wordCount,
				readingMinutes: wordCount === null ? null : wordCount / 200,
			})
			.returning()
		return doc!
	}
	async function finished(
		owner: string,
		documentId: string,
		completedAt: string,
		source: "manual" | "progress" | "bulk" = "manual",
		cycle = 0,
	) {
		await db
			.insert(readingCompletions)
			.values({ userId: owner, documentId, cycle, completedAt: new Date(completedAt), source })
	}

	/**
	 * Days in Santiago, chosen where UTC days would say otherwise: A is Saturday the 24th (Sunday in
	 * UTC), B Sunday the 25th, the last day of the week before; E is 30 September (1 October in UTC).
	 */
	async function library() {
		const owner = await reader()
		const someone = await reader()
		const a = await read(owner, "A", 1000)
		const b = await read(owner, "B", 2000)
		const c = await read(owner, "C", 3000)
		const e = await read(owner, "E", 400)
		const tidied = await read(owner, "Tidied", 5000)
		const trashed = await read(owner, "Trashed", 5000)
		const theirs = await read(someone, "Theirs", 5000)
		const mine = await read(owner, "Mine, finished by them", 5000)
		await finished(owner, a.id, "2026-10-25T02:00:00Z")
		await finished(owner, b.id, "2026-10-25T03:30:00Z")
		await finished(owner, c.id, "2026-10-27T15:00:00Z", "progress", 0)
		await finished(owner, c.id, "2026-10-29T15:00:00Z", "manual", 1)
		await finished(owner, e.id, "2026-10-01T02:00:00Z")
		await finished(owner, tidied.id, "2026-10-30T15:00:00Z", "bulk")
		await finished(owner, trashed.id, "2026-10-30T15:00:00Z")
		await db.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, trashed.id))
		await finished(someone, theirs.id, "2026-10-30T15:00:00Z")
		// Rows that cross owners, which nothing in the schema forbids: neither counts for anyone.
		await finished(owner, theirs.id, "2026-10-30T15:00:00Z", "manual", 1)
		await finished(someone, mine.id, "2026-10-30T15:00:00Z")
		return { owner, someone, a, b, c, e }
	}

	it("totals the past 7 days, the month and the year in the reader's days, each article once", async () => {
		const { owner } = await library()
		const stats = await readingStats(owner, { now, timeZone, by: "week" })
		expect(stats.today).toBe("2026-10-31")
		expect(stats.totals).toEqual({
			week: { articles: 2, words: 5000, minutes: 25 },
			month: { articles: 3, words: 6000, minutes: 30 },
			year: { articles: 4, words: 6400, minutes: 32 },
		})
		expect(stats.days).toEqual({
			"2026-09-30": 1,
			"2026-10-24": 1,
			"2026-10-25": 1,
			"2026-10-27": 1,
			"2026-10-29": 1,
		})
		// A year of whole weeks, from a Monday.
		expect(stats.from).toBe("2025-10-27")
	})

	it("sums twelve weeks from Monday, or twelve months, the current one last", async () => {
		const { owner } = await library()
		const weeks = (await readingStats(owner, { now, timeZone, by: "week" })).periods
		expect(weeks).toHaveLength(12)
		expect(weeks[0]?.start).toBe("2026-08-10")
		expect(weeks.slice(-5)).toEqual([
			{ start: "2026-09-28", articles: 1, words: 400, minutes: 2 },
			{ start: "2026-10-05", articles: 0, words: 0, minutes: 0 },
			{ start: "2026-10-12", articles: 0, words: 0, minutes: 0 },
			{ start: "2026-10-19", articles: 2, words: 3000, minutes: 15 },
			{ start: "2026-10-26", articles: 1, words: 3000, minutes: 15 },
		])
		const months = (await readingStats(owner, { now, timeZone, by: "month" })).periods
		expect(months).toHaveLength(12)
		expect(months[0]?.start).toBe("2025-11-01")
		expect(months.slice(-2)).toEqual([
			{ start: "2026-09-01", articles: 1, words: 400, minutes: 2 },
			{ start: "2026-10-01", articles: 3, words: 6000, minutes: 30 },
		])
	})

	it("lists the chosen period's articles, newest first, and the current one when none is chosen", async () => {
		const { owner, a, b, c } = await library()
		const current = await readingStats(owner, { now, timeZone, by: "week" })
		expect(current.selected).toMatchObject({ start: "2026-10-26", end: "2026-11-01" })
		expect(current.selected.articles).toEqual([
			{ id: c.id, title: "C", siteName: null, words: 3000, minutes: 15, day: "2026-10-29" },
		])
		const before = await readingStats(owner, { now, timeZone, by: "week", start: "2026-10-19" })
		expect(before.selected.end).toBe("2026-10-25")
		expect(before.selected.articles.map((d) => d.id)).toEqual([b.id, a.id])
		// Finished again later in the period: listed by its last finish, before one finished between.
		await finished(owner, a.id, "2026-10-25T20:00:00Z", "manual", 1)
		const again = await readingStats(owner, { now, timeZone, by: "week", start: "2026-10-19" })
		expect(again.selected.articles.map((d) => [d.id, d.day])).toEqual([
			[a.id, "2026-10-25"],
			[b.id, "2026-10-25"],
		])
		const october = await readingStats(owner, { now, timeZone, by: "month", start: "2026-10-01" })
		expect(october.selected.end).toBe("2026-10-31")
		// Not one of the periods shown: the current one.
		const far = await readingStats(owner, { now, timeZone, by: "week", start: "2020-01-06" })
		expect(far.selected.start).toBe("2026-10-26")
	})

	it("names the reader's active topics the chosen period's articles are in, not those only suggested or refused", async () => {
		const { owner, someone, a, b } = await library()
		const topic = (userId: string, name: string, status: "active" | "retired" = "active") => ({
			userId,
			name,
			description: name,
			status,
			origin: "first" as const,
		})
		const [essays, science, refused, retired, foreign] = await db
			.insert(topics)
			.values([
				topic(owner, "Essays"),
				topic(owner, "Science"),
				topic(owner, "Refused"),
				topic(owner, "Retired", "retired"),
				topic(someone, "Foreign"),
			])
			.returning()
		const on = (
			documentId: string,
			topicId: string,
			level: "applied" | "suggested" = "applied",
		) => ({
			documentId,
			topicId,
			probability: 0.9,
			level,
		})
		await db
			.insert(documentTopics)
			.values([
				on(b.id, essays!.id),
				on(a.id, science!.id, "suggested"),
				{ ...on(a.id, refused!.id), refusedAt: new Date() },
				on(a.id, retired!.id),
				on(a.id, foreign!.id),
			])
		const args = { now, timeZone, by: "week", start: "2026-10-19" } as const
		expect((await readingStats(owner, { ...args, topics: true })).selected.topics).toEqual([
			{ id: essays!.id, name: "Essays", articles: 1 },
		])
		expect((await readingStats(owner, args)).selected.topics).toEqual([])
	})

	it("counts by UTC days when the database doesn't know the reader's zone", async () => {
		const { owner } = await library()
		const stats = await readingStats(owner, { now, timeZone: "Mars/Olympus_Mons", by: "week" })
		expect(stats.totals.week).toEqual({ articles: 3, words: 6000, minutes: 30 })
	})
})
