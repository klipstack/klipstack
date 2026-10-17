import { BATCH_MAX } from "@klipstack/api-contract"
import {
	and,
	asc,
	db,
	documents,
	documentTags,
	editionItems,
	editions,
	eq,
	inArray,
	readingCompletions,
	sql,
	tags,
	user as userTable,
} from "@klipstack/db"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { AppError } from "~/lib/app-error"
import {
	addItem,
	createEdition as insertEdition,
	publishEdition,
	updateItem,
} from "~/services/editions.server"
import {
	openArticle,
	purgeArticles,
	restoreArticle,
	restoreArticles,
	saveReadingPosition,
	trashArticles,
	undoArchive,
	undoChanges,
	updateArticle,
	updateArticles,
} from "./articles.server"

const userId = `test-articles-${Date.now()}`
const otherId = `${userId}-other`
let ids: string[] = []
let theirs: string

const insert = async (
	owner: string,
	n: number,
	values: Partial<typeof documents.$inferInsert> = {},
) => {
	const rows = await db
		.insert(documents)
		.values(
			Array.from({ length: n }, (_, i) => ({
				userId: owner,
				sourceUrl: `https://example.com/bulk/${owner}/${i}/${Math.random()}`,
				urlHash: `${owner}-${i}-${Math.random()}`,
				status: "ready" as const,
				...values,
			})),
		)
		.returning({ id: documents.id })
	return rows.map((r) => r.id)
}

/** Columns as Postgres prints them: microseconds included. */
const read = async (id: string) => {
	const [row] = await db
		.select({
			starredAt: sql<string | null>`${documents.starredAt}::text`,
			shortlistedAt: sql<string | null>`${documents.shortlistedAt}::text`,
			archivedAt: sql<string | null>`${documents.archivedAt}::text`,
			readAt: sql<string | null>`${documents.readAt}::text`,
			firstOpenedAt: sql<string | null>`${documents.firstOpenedAt}::text`,
			lastReadAt: sql<string | null>`${documents.lastReadAt}::text`,
			keptAt: sql<string | null>`${documents.keptAt}::text`,
			readingProgress: documents.readingProgress,
			readingPosition: documents.readingPosition,
			readingCycle: documents.readingCycle,
			deletedAt: documents.deletedAt,
		})
		.from(documents)
		.where(eq(documents.id, id))
	return row!
}

beforeAll(async () => {
	await db.insert(userTable).values([
		{ id: userId, name: "Bulk", email: `${userId}@example.com` },
		{ id: otherId, name: "Other", email: `${otherId}@example.com` },
	])
	;[theirs] = (await insert(otherId, 1)) as [string]
})

beforeEach(async () => {
	await db.delete(editions).where(eq(editions.userId, userId))
	await db.delete(documents).where(eq(documents.userId, userId))
	await db.delete(tags).where(eq(tags.userId, userId))
	ids = await insert(userId, 3)
})

afterAll(async () => {
	await db.delete(userTable).where(inArray(userTable.id, [userId, otherId]))
})

describe("star", () => {
	it("changes only the ones that were not starred, and undo unstars only those", async () => {
		const [a, b, c] = ids as [string, string, string]
		await db
			.update(documents)
			.set({ starredAt: sql`'2026-01-02 03:04:05.123456+00'` })
			.where(eq(documents.id, a))
		const before = (await read(a)).starredAt
		const { changed, undo } = await updateArticles(userId, {
			ids: [a, b, c, theirs],
			starred: true,
		})
		expect(changed.sort()).toEqual([b, c].sort())
		expect((await read(a)).starredAt).toBe(before)
		expect((await read(theirs)).starredAt).toBeNull()

		await undoChanges(userId, undo)
		expect((await read(a)).starredAt).toBe(before)
		expect((await read(b)).starredAt).toBeNull()
		expect((await read(c)).starredAt).toBeNull()
	})

	it("undo of unstar puts back the exact time", async () => {
		const [a] = ids as [string]
		await db
			.update(documents)
			.set({ starredAt: sql`'2026-01-02 03:04:05.123456+00'` })
			.where(eq(documents.id, a))
		const before = (await read(a)).starredAt
		const { undo } = await updateArticles(userId, { ids: [a], starred: false })
		expect((await read(a)).starredAt).toBeNull()
		await undoChanges(userId, undo)
		expect((await read(a)).starredAt).toBe(before)
	})
})

describe("the mark for the next edition", () => {
	it("marks only the ones without it, keeps their time, and undo takes it off those", async () => {
		const [a, b] = ids as [string, string]
		await db
			.update(documents)
			.set({ shortlistedAt: sql`'2026-01-02 03:04:05.123456+00'` })
			.where(eq(documents.id, a))
		const before = (await read(a)).shortlistedAt
		const { changed, undo } = await updateArticles(userId, {
			ids: [a, b, theirs],
			shortlisted: true,
		})
		expect(changed).toEqual([b])
		expect((await read(a)).shortlistedAt).toBe(before)
		expect((await read(b)).shortlistedAt).not.toBeNull()
		expect((await read(theirs)).shortlistedAt).toBeNull()
		await undoChanges(userId, undo)
		expect((await read(a)).shortlistedAt).toBe(before)
		expect((await read(b)).shortlistedAt).toBeNull()

		const off = await updateArticles(userId, { ids: [a], shortlisted: false })
		expect((await read(a)).shortlistedAt).toBeNull()
		await undoChanges(userId, off.undo)
		expect((await read(a)).shortlistedAt).toBe(before)
	})

	it("stays on an article in the trash, which it does not change", async () => {
		const [a] = ids as [string]
		await updateArticles(userId, { ids: [a], shortlisted: true })
		await trashArticles(userId, [a])
		expect((await updateArticles(userId, { ids: [a], shortlisted: false })).notFound).toEqual([a])
		expect((await read(a)).shortlistedAt).not.toBeNull()
	})
})

describe("keep", () => {
	it("keeps them all from now, a kept one again, and undo puts back when each was kept", async () => {
		const [a, b] = ids as [string, string, string]
		await db
			.update(documents)
			.set({ keptAt: sql`'2026-01-02 03:04:05.123456+00'` })
			.where(eq(documents.id, a))
		const start = Date.now()
		const { changed, undo } = await updateArticles(userId, { ids: [a, b, theirs], kept: true })
		const end = Date.now()
		expect(changed.sort()).toEqual([a, b].sort())
		for (const id of [a, b]) {
			const keptAt = Date.parse((await read(id)).keptAt!)
			expect(keptAt).toBeGreaterThanOrEqual(start - 1000)
			expect(keptAt).toBeLessThanOrEqual(end + 1000)
		}
		expect((await read(theirs)).keptAt).toBeNull()

		await undoChanges(userId, undo)
		expect((await read(a)).keptAt).toBe("2026-01-02 03:04:05.123456+00")
		expect((await read(b)).keptAt).toBeNull()
	})

	it("kept: false forgets only the kept ones, and undo keeps them again", async () => {
		const [a, b] = ids as [string, string, string]
		await db
			.update(documents)
			.set({ keptAt: sql`'2026-01-02 03:04:05.123456+00'` })
			.where(eq(documents.id, a))
		const { changed, undo } = await updateArticles(userId, { ids: [a, b], kept: false })
		expect(changed).toEqual([a])
		expect((await read(a)).keptAt).toBeNull()

		await undoChanges(userId, undo)
		expect((await read(a)).keptAt).toBe("2026-01-02 03:04:05.123456+00")
		expect((await read(b)).keptAt).toBeNull()
	})

	it("is left out of the message for a request without changes: MCP can't keep", async () => {
		const [a] = ids as [string]
		const refusal = updateArticles(userId, { ids: [a] })
		await expect(refusal).rejects.toMatchObject({ code: "invalid_request" })
		await expect(refusal).rejects.not.toThrow(/kept/)
	})
})

describe("the mark, with a draft in progress", () => {
	const draftOf = () => insertEdition(userId, { locale: "en", timeZone: "Europe/Madrid" })
	/** The draft's articles in order, and whether each includes its note. */
	const itemsOf = async (editionId: string) =>
		db
			.select({
				documentId: editionItems.documentId,
				position: editionItems.position,
				includeNote: editionItems.includeNote,
			})
			.from(editionItems)
			.where(eq(editionItems.editionId, editionId))
			.orderBy(asc(editionItems.position))

	it("adds the articles to the end of the draft, once; undo takes them out with the mark", async () => {
		const [a, b, c] = ids as [string, string, string]
		const [noUrl] = await insert(userId, 1, { sourceUrl: "file:///local.pdf" })
		const published = await draftOf()
		await addItem(userId, published.id, a)
		expect((await publishEdition(userId, published.id)).ok).toBe(true)
		const draft = await draftOf()
		await addItem(userId, draft.id, c)

		const {
			changed,
			undo,
			draft: inDraft,
		} = await updateArticles(userId, {
			ids: [b, a, c, noUrl!],
			shortlisted: true,
		})
		// c, added from the picker, is marked already.
		expect(changed.sort()).toEqual([a, b, noUrl].sort())
		expect(inDraft).toEqual({ added: [b, a], removed: [] })
		expect(await itemsOf(draft.id)).toEqual([
			{ documentId: c, position: 0, includeNote: false },
			{ documentId: b, position: 1, includeNote: false },
			{ documentId: a, position: 2, includeNote: false },
		])
		// Without a web address it is only marked; a published edition is left alone.
		expect((await read(noUrl!)).shortlistedAt).not.toBeNull()
		expect((await itemsOf(published.id)).map((i) => i.documentId)).toEqual([a])

		await undoChanges(userId, undo)
		expect((await itemsOf(draft.id)).map((i) => i.documentId)).toEqual([c])
		for (const id of [a, b, noUrl!]) expect((await read(id)).shortlistedAt).toBeNull()
		expect((await read(c)).shortlistedAt).not.toBeNull()
	})

	it("unmarking takes the article out of the draft; undo puts it back as it was", async () => {
		const [a, b, c] = ids as [string, string, string]
		const draft = await draftOf()
		await updateArticles(userId, { ids: [a, b, c], shortlisted: true })
		const [, item] = await db
			.select({ id: editionItems.id })
			.from(editionItems)
			.where(eq(editionItems.editionId, draft.id))
			.orderBy(asc(editionItems.position))
		await updateItem(userId, draft.id, item!.id, { note: "Mine.", includeNote: true })
		const marked = (await read(b)).shortlistedAt

		const {
			changed,
			undo,
			draft: outOfDraft,
		} = await updateArticles(userId, {
			ids: [b],
			shortlisted: false,
		})
		expect(changed).toEqual([b])
		expect(outOfDraft).toEqual({ added: [], removed: [b] })
		expect(await itemsOf(draft.id)).toEqual([
			{ documentId: a, position: 0, includeNote: false },
			{ documentId: c, position: 1, includeNote: false },
		])
		expect((await read(b)).shortlistedAt).toBeNull()

		await undoChanges(userId, undo)
		expect(await itemsOf(draft.id)).toEqual([
			{ documentId: a, position: 0, includeNote: false },
			{ documentId: b, position: 1, includeNote: true },
			{ documentId: c, position: 2, includeNote: false },
		])
		expect((await read(b)).shortlistedAt).toBe(marked)
	})
})

describe("the mark and the draft, at the edges", () => {
	const draftOf = () => insertEdition(userId, { locale: "en", timeZone: "Europe/Madrid" })
	const docsOf = async (editionId: string) =>
		(
			await db
				.select({ documentId: editionItems.documentId })
				.from(editionItems)
				.where(eq(editionItems.editionId, editionId))
				.orderBy(asc(editionItems.position))
		).map((row) => row.documentId)

	it("without a draft in progress, the mark is all that changes", async () => {
		const [a] = ids as [string]
		const marked = await updateArticles(userId, { ids: [a], shortlisted: true })
		expect(marked).toMatchObject({ changed: [a], draft: { added: [], removed: [] } })
		const unmarked = await updateArticles(userId, { ids: [a], shortlisted: false })
		expect(unmarked).toMatchObject({ changed: [a], draft: { added: [], removed: [] } })
	})

	it("unmarking names only the articles the draft had", async () => {
		const [a, b] = ids as [string, string]
		// Marked before the draft was started: not in it.
		await updateArticles(userId, { ids: [a], shortlisted: true })
		const draft = await draftOf()
		await updateArticles(userId, { ids: [b], shortlisted: true })
		const unmarked = await updateArticles(userId, { ids: [a, b], shortlisted: false })
		expect(unmarked).toMatchObject({ changed: [a, b], draft: { added: [], removed: [b] } })
		expect(await docsOf(draft.id)).toEqual([])
	})

	it("finishing and marking at once dates the item the day it was finished", async () => {
		const [a] = ids as [string]
		const draft = await draftOf()
		await updateArticles(userId, { ids: [a], finished: true, shortlisted: true })
		const [item] = await db
			.select({ readOn: editionItems.readOn })
			.from(editionItems)
			.where(eq(editionItems.editionId, draft.id))
		expect(item?.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
	})

	it("undo leaves a draft alone once it is published, and does not add an article twice", async () => {
		const [a, b] = ids as [string, string]
		const draft = await draftOf()
		const marked = await updateArticles(userId, { ids: [a], shortlisted: true })
		expect((await publishEdition(userId, draft.id)).ok).toBe(true)
		await undoChanges(userId, marked.undo)
		expect(await docsOf(draft.id)).toEqual([a])

		const next = await draftOf()
		await updateArticles(userId, { ids: [b], shortlisted: true })
		const off = await updateArticles(userId, { ids: [b], shortlisted: false })
		// Added again from the picker before the undo: once is enough.
		await addItem(userId, next.id, b)
		await undoChanges(userId, off.undo)
		expect(await docsOf(next.id)).toEqual([b])
	})

	it("keeps an undo small enough to send back, whatever the draft's notes", async () => {
		const [a, b] = ids as [string, string]
		const draft = await draftOf()
		await updateArticles(userId, { ids: [a, b], shortlisted: true })
		const long = "x".repeat(60_000)
		await db.update(editionItems).set({ note: long }).where(eq(editionItems.editionId, draft.id))
		const { undo } = await updateArticles(userId, { ids: [a, b], shortlisted: false })
		expect(JSON.stringify(undo).length).toBeLessThan(48 * 1024)
		expect(await docsOf(draft.id)).toEqual([])
		// What did not fit is copied from the library again, in its place.
		await undoChanges(userId, undo)
		expect(await docsOf(draft.id)).toEqual([a, b])
		for (const id of [a, b]) expect((await read(id)).shortlistedAt).not.toBeNull()
	})
})

describe("archive and back", () => {
	it("moving back to the library resets reading, and undo restores it", async () => {
		const [a] = ids as [string]
		await db
			.update(documents)
			.set({
				archivedAt: sql`'2026-03-04 05:06:07.654321+00'`,
				readAt: sql`'2026-03-04 05:06:07.111111+00'`,
				readingProgress: 1,
				readingPosition: 0.97,
				readingCycle: 2,
			})
			.where(eq(documents.id, a))
		const before = await read(a)
		const { changed, undo } = await updateArticles(userId, { ids: [a], location: "inbox" })
		expect(changed).toEqual([a])
		expect(await read(a)).toMatchObject({ archivedAt: null, readAt: null, readingCycle: 3 })
		await undoChanges(userId, undo)
		expect(await read(a)).toEqual(before)
	})

	it("archiving skips archived ones", async () => {
		const [a, b] = ids as [string, string]
		await updateArticles(userId, { ids: [a], location: "archive" })
		const { changed } = await updateArticles(userId, { ids: [a, b], location: "archive" })
		expect(changed).toEqual([b])
	})
})

describe("finish", () => {
	it("finishes, archives, records a completion; undo takes it all back", async () => {
		const [a, b] = ids as [string, string]
		await db
			.update(documents)
			.set({ readingProgress: 0.4, firstOpenedAt: sql`now() - interval '1 day'` })
			.where(eq(documents.id, a))
		const before = { a: await read(a), b: await read(b) }
		const { changed, undo } = await updateArticles(userId, { ids: [a, b], finished: true })
		expect(changed.sort()).toEqual([a, b].sort())
		expect(await read(a)).toMatchObject({ readingProgress: 1 })
		expect((await read(a)).readAt).not.toBeNull()
		expect((await read(b)).archivedAt).not.toBeNull()
		const completions = () =>
			db
				.select()
				.from(readingCompletions)
				.where(inArray(readingCompletions.documentId, [a, b]))
		expect(await completions()).toHaveLength(2)

		await undoChanges(userId, undo)
		expect(await read(a)).toEqual(before.a)
		expect(await read(b)).toEqual(before.b)
		expect(await completions()).toHaveLength(0)
	})
})

describe("unread", () => {
	it("resets opened articles only, and undo restores them", async () => {
		const [a, b] = ids as [string, string]
		await db
			.update(documents)
			.set({
				firstOpenedAt: sql`now()`,
				readingProgress: 0.5,
				readingPosition: 0.5,
				lastReadAt: sql`now()`,
			})
			.where(eq(documents.id, a))
		const before = await read(a)
		const { changed, undo } = await updateArticles(userId, { ids: [a, b], finished: false })
		expect(changed).toEqual([a])
		expect(await read(a)).toMatchObject({ firstOpenedAt: null, readingProgress: 0 })
		await undoChanges(userId, undo)
		expect(await read(a)).toEqual(before)
	})
})

describe("tags", () => {
	it("adds to all, and undo removes only what it added, and the tags it made", async () => {
		const [a, b] = ids as [string, string]
		const [kept] = await db.insert(tags).values({ userId, name: "kept" }).returning({ id: tags.id })
		await db.insert(documentTags).values({ documentId: a, tagId: kept!.id })

		const { changed, undo } = await updateArticles(userId, {
			ids: [a, b, theirs],
			addTags: ["kept", "fresh"],
		})
		expect(changed.sort()).toEqual([a, b].sort())
		expect(undo.tagLinks).toHaveLength(3)
		expect(undo.tags).toHaveLength(1)

		await undoChanges(userId, undo)
		const links = await db
			.select({ documentId: documentTags.documentId })
			.from(documentTags)
			.where(inArray(documentTags.documentId, [a, b]))
		expect(links).toEqual([{ documentId: a }])
		const names = await db.select({ name: tags.name }).from(tags).where(eq(tags.userId, userId))
		expect(names).toEqual([{ name: "kept" }])
	})

	it("keeps a tag it made when something else uses it by the time of undo", async () => {
		const [a, b] = ids as [string, string]
		const { undo } = await updateArticles(userId, { ids: [a], addTags: ["shared"] })
		const [tag] = await db
			.select({ id: tags.id })
			.from(tags)
			.where(and(eq(tags.userId, userId), eq(tags.name, "shared")))
		await db.insert(documentTags).values({ documentId: b, tagId: tag!.id })
		await undoChanges(userId, undo)
		expect(await db.select().from(tags).where(eq(tags.id, tag!.id))).toHaveLength(1)
	})
})

describe("trash", () => {
	it("deletes live ones, restores trashed ones, and reports a page saved again", async () => {
		const [a, b, c] = ids as [string, string, string]
		expect(await trashArticles(userId, [a, b, theirs])).toEqual({
			trashed: [a, b],
			notFound: [theirs],
		})
		expect(await trashArticles(userId, [a])).toEqual({ trashed: [], notFound: [a] })
		expect((await read(theirs)).deletedAt).toBeNull()

		// b's page is saved again while b is in the trash
		const [hash] = await db
			.select({ urlHash: documents.urlHash })
			.from(documents)
			.where(eq(documents.id, b))
		const [again] = await insert(userId, 1, { urlHash: hash!.urlHash })
		const { restored, notFound, alreadySaved } = await restoreArticles(userId, [a, b, c])
		expect(restored).toEqual([a])
		expect(notFound).toEqual([c])
		expect(alreadySaved).toEqual([{ id: b, articleId: again }])
		expect((await read(b)).deletedAt).not.toBeNull()
		// One at a time, the same refusal is an error that names the live article.
		await expect(restoreArticle(userId, b)).rejects.toMatchObject({
			code: "already_saved",
			details: { articleId: again },
		})
		await expect(restoreArticle(userId, c)).rejects.toMatchObject({ code: "not_found" })
	})
})

describe("updateArticles", () => {
	it("changes every live article given, failed saves too, and nothing else", async () => {
		const [failed] = await insert(userId, 1, { status: "failed" })
		const [trashed] = await insert(userId, 1, { deletedAt: new Date() })
		const [starred] = await insert(userId, 1, { starredAt: new Date("2026-01-01T00:00:00Z") })
		const result = await updateArticles(userId, {
			ids: [...ids, failed!, trashed!, starred!, theirs],
			finished: true,
			starred: true,
		})
		expect(result.found).toEqual([...ids, failed!, starred!])
		expect(result.notFound).toEqual([trashed!, theirs])
		for (const id of [...ids, failed!]) {
			const row = await read(id)
			expect(row.readAt).not.toBeNull()
			expect(row.archivedAt).not.toBeNull()
			expect(row.starredAt).not.toBeNull()
		}
		expect(await read(trashed!)).toMatchObject({ readAt: null, starredAt: null })
		expect(await read(theirs)).toMatchObject({ readAt: null, starredAt: null })
		expect((await read(starred!)).starredAt).toBe("2026-01-01 00:00:00+00")
		expect(
			await db.select().from(readingCompletions).where(inArray(readingCompletions.documentId, ids)),
		).toHaveLength(3)
	})
})

describe("tags off", () => {
	it("takes tags off, and undo puts them back", async () => {
		const [a, b] = ids as [string, string]
		await updateArticles(userId, { ids: [a, b], addTags: ["one", "two"] })
		const { changed, undo } = await updateArticles(userId, { ids: [a, b], removeTags: ["ONE"] })
		expect(changed).toEqual([a, b])
		const names = async (id: string) =>
			(
				await db
					.select({ name: tags.name })
					.from(documentTags)
					.innerJoin(tags, eq(tags.id, documentTags.tagId))
					.where(eq(documentTags.documentId, id))
			)
				.map((t) => t.name)
				.sort()
		expect(await names(a)).toEqual(["two"])
		await undoChanges(userId, undo)
		expect(await names(a)).toEqual(["one", "two"])
		expect(await names(b)).toEqual(["one", "two"])
	})
})

describe("one article", () => {
	it("renames, and refuses a title for several articles", async () => {
		const [a, b] = ids as [string, string]
		expect(await updateArticle(userId, a, { title: "  A new title  " })).toMatchObject({
			changed: true,
		})
		const [row] = await db
			.select({ title: documents.title, titleEdited: documents.titleEdited })
			.from(documents)
			.where(eq(documents.id, a))
		expect(row).toEqual({ title: "A new title", titleEdited: true })
		expect((await updateArticle(userId, a, { title: "A new title" })).changed).toBe(false)
		await expect(updateArticles(userId, { ids: [a, b], title: "Both" })).rejects.toMatchObject({
			code: "invalid_request",
		})
	})

	it("is not found when it is another user's or in the trash", async () => {
		const [a] = ids as [string]
		await expect(updateArticle(userId, theirs, { starred: true })).rejects.toMatchObject({
			code: "not_found",
		})
		await trashArticles(userId, [a])
		await expect(updateArticle(userId, a, { starred: true })).rejects.toMatchObject({
			code: "not_found",
		})
		await expect(openArticle(userId, a)).rejects.toMatchObject({ code: "not_found" })
		await expect(saveReadingPosition(userId, a, { position: 0.5 })).rejects.toMatchObject({
			code: "not_found",
		})
	})

	it("refuses input past the limits, the same for every caller", async () => {
		const [a] = ids as [string]
		const refusal = (run: Promise<unknown>) => run.catch((e: unknown) => e)
		const none = await refusal(updateArticles(userId, { ids: [a] }))
		expect(none).toBeInstanceOf(AppError)
		expect(none).toMatchObject({ code: "invalid_request", status: 400 })
		const many = Array.from({ length: BATCH_MAX + 1 }, () => crypto.randomUUID())
		expect(await refusal(updateArticles(userId, { ids: many, starred: true }))).toMatchObject({
			code: "invalid_request",
		})
		expect(await refusal(updateArticle(userId, "not-an-id", { starred: true }))).toMatchObject({
			code: "invalid_request",
		})
		expect(
			await refusal(updateArticles(userId, { ids: [a], finished: true, location: "inbox" })),
		).toMatchObject({ code: "invalid_request" })
	})
})

describe("reading", () => {
	it("ignores a position from an older reading cycle, and records a completion at the end", async () => {
		const [a] = ids as [string]
		const opened = await openArticle(userId, a)
		await saveReadingPosition(userId, a, { position: 0.99, cycle: opened.readingCycle + 1 })
		expect((await read(a)).readingPosition).toBe(0)
		await saveReadingPosition(userId, a, { position: 0.99, cycle: opened.readingCycle })
		expect(await read(a)).toMatchObject({ readingPosition: 0.99, readingProgress: 0.99 })
		expect(
			await db.select().from(readingCompletions).where(eq(readingCompletions.documentId, a)),
		).toHaveLength(1)
	})

	it("records listening to the end as listened, also over a completion from scrolling", async () => {
		const [a, b] = ids as [string, string]
		const sources = async (id: string) =>
			(
				await db
					.select({ source: readingCompletions.source })
					.from(readingCompletions)
					.where(eq(readingCompletions.documentId, id))
			).map((c) => c.source)
		// Listening part of the way records nothing.
		await saveReadingPosition(userId, a, { position: 0.5, listened: true })
		expect(await sources(a)).toEqual([])
		await saveReadingPosition(userId, a, { position: 1, listened: true })
		expect(await sources(a)).toEqual(["listened"])
		// The page followed the voice to the end first: the cycle was still listened to.
		await saveReadingPosition(userId, b, { position: 0.99 })
		await saveReadingPosition(userId, b, { position: 1, listened: true })
		expect(await sources(b)).toEqual(["listened"])
		// A finish stays a finish.
		await updateArticles(userId, { ids: [a, b], finished: true })
		const [c] = ids.slice(2) as [string]
		await updateArticle(userId, c, { finished: true })
		await saveReadingPosition(userId, c, { position: 1, listened: true })
		expect(await sources(c)).toEqual(["manual"])
	})

	it("undoing an archive keeps the article finished", async () => {
		const [a] = ids as [string]
		await updateArticles(userId, { ids: [a], finished: true })
		expect(await undoArchive(userId, [a])).toEqual([a])
		expect((await read(a)).archivedAt).toBeNull()
		expect((await read(a)).readAt).not.toBeNull()
	})

	it("deletes for good from the trash only", async () => {
		const [a, b] = ids as [string, string]
		await trashArticles(userId, [a])
		expect(await purgeArticles(userId, [a, b])).toEqual({ purged: [a], notFound: [b] })
		expect(await db.select().from(documents).where(eq(documents.id, a))).toHaveLength(0)
	})
})
