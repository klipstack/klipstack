import {
	db,
	documentRaw,
	documents,
	documentVersions,
	eq,
	readingCompletions,
	sql,
	user as userTable,
} from "@klipstack/db"
import { normalizeUrl, urlHash } from "@klipstack/extract"
import { stopBoss } from "@klipstack/queue"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
	openArticle,
	purgeArticles,
	REREAD_AFTER_HOURS,
	saveReadingPosition,
	trashArticles,
	updateArticle,
} from "~/commands/articles.server"
import { isUniqueViolation } from "~/lib/postgres-errors.server"
import {
	getDocument,
	liveDuplicateOf,
	restoreDocument,
	savedLinksIn,
	setNote,
} from "./documents.server"

const userId = `test-docs-${Date.now()}`
let documentId: string

const state = async () => {
	const d = await db.query.documents.findFirst({ where: eq(documents.id, documentId) })
	return { progress: d!.readingProgress, position: d!.readingPosition, readAt: d!.readAt }
}
const set = (values: Partial<typeof documents.$inferInsert>) =>
	db.update(documents).set(values).where(eq(documents.id, documentId))
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000)

beforeAll(async () => {
	await db.insert(userTable).values({ id: userId, name: "Docs", email: `${userId}@example.com` })
	const [d] = await db
		.insert(documents)
		.values({ userId, sourceUrl: "https://example.com/r", urlHash: userId, status: "ready" })
		.returning({ id: documents.id })
	documentId = d!.id
})

afterAll(async () => {
	await db.execute(
		sql`delete from pgboss.job where data->>'documentId' in (select id::text from documents where user_id = ${userId}) or data->>'versionId' in (select v.id::text from document_versions v join documents d on d.id = v.document_id where d.user_id = ${userId})`,
	)
	await db.delete(userTable).where(eq(userTable.id, userId))
	await stopBoss()
})

describe("unarchive", () => {
	it("drops progress to where the reader left off", async () => {
		await set({
			readingProgress: 1,
			readingPosition: 0.6,
			readAt: new Date(),
			archivedAt: new Date(),
		})
		await updateArticle(userId, documentId, { location: "inbox" })
		expect(await state()).toEqual({ progress: 0.6, position: 0.6, readAt: null })
	})

	it("starts over when the reader left off at the end", async () => {
		await set({ readingProgress: 1, readingPosition: 0.97, archivedAt: new Date() })
		await updateArticle(userId, documentId, { location: "inbox" })
		expect(await state()).toEqual({ progress: 0, position: 0, readAt: null })
		// reading it again shows progress again
		await saveReadingPosition(userId, documentId, { position: 0.5 })
		expect((await state()).progress).toBe(0.5)
	})
})

describe("getDocument", () => {
	it("leaves out the search vector, which the reader would send to the browser", async () => {
		await db
			.update(documents)
			.set({ search: sql`to_tsvector('simple', 'some words')` })
			.where(eq(documents.id, documentId))
		const doc = await getDocument(userId, documentId)
		expect(doc?.id).toBe(documentId)
		expect(doc).not.toHaveProperty("search")
	})
})

describe("opening a finished inbox article", () => {
	it("starts a new read after a while", async () => {
		await set({
			readingProgress: 1,
			readAt: new Date(),
			archivedAt: null,
			lastReadAt: hoursAgo(REREAD_AFTER_HOURS + 1),
		})
		await openArticle(userId, documentId)
		expect(await state()).toMatchObject({ progress: 0, readAt: null })
	})

	it("stays finished when opened again soon, or from the archive", async () => {
		await set({ readingProgress: 1, archivedAt: null, lastReadAt: hoursAgo(1) })
		await openArticle(userId, documentId)
		expect((await state()).progress).toBe(1)

		await set({
			readingProgress: 1,
			archivedAt: new Date(),
			lastReadAt: hoursAgo(REREAD_AFTER_HOURS + 1),
		})
		await openArticle(userId, documentId)
		expect((await state()).progress).toBe(1)
	})
})

describe("article note", () => {
	it("trims, clears when blank, and stamps the time", async () => {
		const saved = await setNote(userId, documentId, "  my take \n")
		expect(saved?.note).toBe("my take")
		expect(saved?.noteUpdatedAt).toBeInstanceOf(Date)
		expect((await setNote(userId, documentId, "   "))?.note).toBeNull()
		expect((await setNote(userId, documentId, null))?.note).toBeNull()
	})

	it("does not touch another user's document", async () => {
		await setNote(userId, documentId, "mine")
		expect(await setNote("someone-else", documentId, "theirs")).toBeNull()
		const d = await db.query.documents.findFirst({ where: eq(documents.id, documentId) })
		expect(d?.note).toBe("mine")
	})
})

describe("note conflicts", () => {
	it("writes only when the note is as expected, and returns the current one otherwise", async () => {
		await set({ note: null, noteUpdatedAt: null })
		const first = await setNote(userId, documentId, "one", { expectedUpdatedAt: null })
		expect(first).toMatchObject({ ok: true, note: "one", noteUpdatedAt: expect.any(Date) })
		if (!first?.ok) throw new Error("expected a save")

		// Saved once, so "never saved" no longer holds.
		expect(await setNote(userId, documentId, "two", { expectedUpdatedAt: null })).toEqual({
			ok: false,
			current: { note: "one", noteUpdatedAt: first.noteUpdatedAt },
		})
		const stale = new Date(first.noteUpdatedAt!.getTime() - 1).toISOString()
		expect(await setNote(userId, documentId, "two", { expectedUpdatedAt: stale })).toMatchObject({
			ok: false,
		})
		// Microseconds in the database are ignored; the millisecond decides.
		await db
			.update(documents)
			.set({
				noteUpdatedAt: sql`date_trunc('milliseconds', note_updated_at) + interval '400 microseconds'`,
			})
			.where(eq(documents.id, documentId))
		const second = await setNote(userId, documentId, "", {
			expectedUpdatedAt: first.noteUpdatedAt!.toISOString(),
		})
		expect(second).toMatchObject({ ok: true, note: null })
		// Without a check, it always writes; an unknown article is null either way.
		expect(await setNote(userId, documentId, "three")).toMatchObject({ note: "three" })
		const missing = "00000000-0000-4000-8000-000000000000"
		expect(await setNote(userId, missing, "x")).toBeNull()
		expect(await setNote(userId, missing, "x", { expectedUpdatedAt: null })).toBeNull()
	})
})

describe("note times", () => {
	it("move forward on every save, even within one millisecond", async () => {
		const times: number[] = []
		for (let i = 0; i < 20; i++) {
			const saved = await setNote(userId, documentId, `burst ${i}`)
			times.push(saved!.noteUpdatedAt!.getTime())
		}
		for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]!)
		// A time read before the last save never matches after it.
		const stale = new Date(times.at(-2)!).toISOString()
		expect(await setNote(userId, documentId, "late", { expectedUpdatedAt: stale })).toMatchObject({
			ok: false,
			current: { note: "burst 19" },
		})
	})

	it("stay truncated to the millisecond", async () => {
		const saved = await setNote(userId, documentId, "precise")
		const [row] = await db
			.select({ us: sql<number>`extract(microseconds from note_updated_at)::int % 1000` })
			.from(documents)
			.where(eq(documents.id, documentId))
		expect(row?.us).toBe(0)
		expect(saved?.noteUpdatedAt).toBeInstanceOf(Date)
	})
})

describe("trash and restore", () => {
	it("report whether anything changed", async () => {
		expect(await restoreDocument(userId, documentId)).toBe(false)
		expect((await trashArticles(userId, [documentId])).trashed).toEqual([documentId])
		expect((await trashArticles(userId, [documentId])).trashed).toEqual([])
		expect(await restoreDocument("someone-else", documentId)).toBe(false)
		expect(await restoreDocument(userId, documentId)).toBe(true)
	})

	it("queues again the work the trash stopped", async () => {
		const trashed = (status: "queued" | "ready") =>
			db
				.insert(documents)
				.values({
					userId,
					sourceUrl: "https://example.com/stopped",
					urlHash: `stopped-${status}-${userId}`,
					status,
					deletedAt: new Date(),
				})
				.returning({ id: documents.id })
				.then((rows) => rows[0]!.id)
		const jobs = async (name: string, key: string, id: string) =>
			(
				await db.execute<{ state: string }>(
					sql`select state from pgboss.job where name = ${name} and data->>${key} = ${id}`,
				)
			).rows.map((row) => row.state)

		const unextracted = await trashed("queued")
		expect(await restoreDocument(userId, unextracted)).toBe(true)
		expect(await jobs("extract", "documentId", unextracted)).toEqual(["created"])

		const withImages = await trashed("ready")
		const [raw] = await db
			.insert(documentRaw)
			.values({ documentId: withImages, rawHtml: Buffer.from(""), source: "extension" })
			.returning({ id: documentRaw.id })
		const [version] = await db
			.insert(documentVersions)
			.values({
				documentId: withImages,
				rawId: raw!.id,
				version: 1,
				html: "<p>x</p>",
				text: "x",
				textHash: "x",
				extractor: "test",
				extractorVersion: "1",
			})
			.returning({ id: documentVersions.id })
		await db
			.update(documents)
			.set({ currentVersionId: version!.id })
			.where(eq(documents.id, withImages))
		expect(await restoreDocument(userId, withImages)).toBe(true)
		expect(await jobs("images", "versionId", version!.id)).toEqual(["created"])
		expect(await jobs("extract", "documentId", withImages)).toEqual([])
	})

	it("refuses to restore an article whose URL was saved again, and names that one", async () => {
		const url = `https://example.com/dup-${Date.now()}`
		const [old] = await db
			.insert(documents)
			.values({ userId, sourceUrl: url, urlHash: `dup-${userId}`, deletedAt: new Date() })
			.returning({ id: documents.id })
		const [again] = await db
			.insert(documents)
			.values({ userId, sourceUrl: url, urlHash: `dup-${userId}` })
			.returning({ id: documents.id })
		const error = await restoreDocument(userId, old!.id).catch((e: unknown) => e)
		expect(isUniqueViolation(error)).toBe(true)
		expect(await liveDuplicateOf(userId, old!.id)).toBe(again!.id)
		expect(isUniqueViolation(new Error("other"))).toBe(false)
	})
})

describe("an article in the trash", () => {
	it("is left alone by the one-article changes, and only it can be purged", async () => {
		const [trashed] = await db
			.insert(documents)
			.values({
				userId,
				sourceUrl: "https://example.com/trashed",
				urlHash: `trashed-${userId}`,
				status: "ready",
				deletedAt: new Date(),
			})
			.returning()
		const id = trashed!.id
		for (const changes of [
			{ starred: true },
			{ location: "archive" as const },
			{ title: "Renamed" },
			{ finished: true },
		])
			await expect(updateArticle(userId, id, changes)).rejects.toMatchObject({ code: "not_found" })
		await expect(saveReadingPosition(userId, id, { position: 0.95 })).rejects.toMatchObject({
			code: "not_found",
		})
		await expect(openArticle(userId, id)).rejects.toMatchObject({ code: "not_found" })
		expect(await db.query.documents.findFirst({ where: eq(documents.id, id) })).toEqual(trashed)
		expect(
			await db.query.readingCompletions.findMany({
				where: eq(readingCompletions.documentId, id),
			}),
		).toEqual([])

		await purgeArticles(userId, [documentId])
		expect(
			await db.query.documents.findFirst({ where: eq(documents.id, documentId) }),
		).toBeDefined()
		await purgeArticles(userId, [id])
		expect(await db.query.documents.findFirst({ where: eq(documents.id, id) })).toBeUndefined()
	})
})

describe("starring", () => {
	const starredAt = async () =>
		(await db.query.documents.findFirst({ where: eq(documents.id, documentId) }))!.starredAt

	it("keeps the first star's time when starred again", async () => {
		await updateArticle(userId, documentId, { starred: true })
		const first = await starredAt()
		expect(first).toBeInstanceOf(Date)
		await updateArticle(userId, documentId, { starred: true })
		expect(await starredAt()).toEqual(first)
		await updateArticle(userId, documentId, { starred: false })
		expect(await starredAt()).toBeNull()
	})
})

describe("savedLinksIn", () => {
	const page = (name: string) => `https://links.example/${name}`
	const hashOf = (url: string) => urlHash(normalizeUrl(url))
	let liveId: string
	let trashedId: string

	beforeAll(async () => {
		const [live, trashed] = await db
			.insert(documents)
			.values([
				{ userId, sourceUrl: page("live"), urlHash: hashOf(page("live")), status: "ready" },
				{
					userId,
					sourceUrl: page("trashed"),
					urlHash: hashOf(page("trashed")),
					status: "ready",
					deletedAt: new Date(),
				},
			])
			.returning({ id: documents.id })
		liveId = live!.id
		trashedId = trashed!.id
	})

	it("maps each href as written to the library article it points at", async () => {
		const html = `<a href="${page("live")}/?utm_source=x">one</a> <a href="/live#part">two</a>
			<a href="${page("trashed")}">gone</a> <a href="${page("unsaved")}">no</a> <a href="#top">in page</a>`
		expect(await savedLinksIn(userId, documentId, html, page("here"))).toEqual({
			[`${page("live")}/?utm_source=x`]: liveId,
			"/live#part": liveId,
		})
		expect(trashedId).toBeTruthy()
	})

	it("leaves out a link to the article itself, and another user's articles", async () => {
		const html = `<a href="${page("live")}">self</a>`
		expect(await savedLinksIn(userId, liveId, html, page("here"))).toEqual({})
		expect(await savedLinksIn(`${userId}-other`, documentId, html, page("here"))).toEqual({})
	})
})
