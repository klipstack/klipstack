import {
	db,
	documentLinks,
	documents,
	documentVersions,
	eq,
	highlights,
	sql,
	user,
} from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { updateArticle } from "~/commands/articles.server"
import { listArticleNotes } from "./article-notes.server"
import { decodeCursor, listDocuments } from "./documents.server"
import { listUserHighlights } from "./highlights.server"
import { listNoteLinks, syncNoteLinks } from "./links.server"
import { searchDocuments } from "./search.server"

/** Link rows as a note save writes them: in the save's transaction. */
const sync = (note: Parameters<typeof syncNoteLinks>[0]) =>
	db.transaction((tx) => syncNoteLinks(note, tx))

const userId = `test-discovery-${Date.now()}`
const otherUserId = `${userId}-other`
const ids: Record<string, string> = {}
const highlightIds: Record<string, string> = {}
const edited = "2026-09-10T12:00:00.123456Z"
const link = (id: string) => `[Target](/read/${id})`

beforeAll(async () => {
	await db.insert(user).values([
		{ id: userId, name: "Discovery", email: `${userId}@example.com` },
		{ id: otherUserId, name: "Other", email: `${otherUserId}@example.com` },
	])
	for (const name of ["source", "target", "isolated", "cleared", "trashed", "foreign"]) {
		const [doc] = await db
			.insert(documents)
			.values({
				userId: name === "foreign" ? otherUserId : userId,
				title: name,
				sourceUrl: `https://example.com/${name}`,
				urlHash: `${userId}-${name}`,
				status: "ready",
				note: ["cleared", "isolated"].includes(name) ? null : "orbital compass",
				noteUpdatedAt: name === "isolated" ? null : sql`${edited}::timestamptz`,
				deletedAt: name === "trashed" ? new Date() : null,
				archivedAt: name === "target" ? new Date() : null,
				starredAt: name === "target" ? new Date() : null,
			})
			.returning()
		ids[name] = doc!.id
	}
	await db
		.update(documents)
		.set({
			note: "different words",
		})
		.where(eq(documents.id, ids.target!))
	await db
		.update(documents)
		.set({
			noteUpdatedAt: sql`'2026-09-10T12:00:00.123457Z'::timestamptz`,
		})
		.where(eq(documents.id, ids.cleared!))

	for (const name of ["source", "trashed", "foreign"]) {
		const uid = name === "foreign" ? otherUserId : userId
		const [version] = await db
			.insert(documentVersions)
			.values({
				documentId: ids[name]!,
				version: 1,
				html: "<p>Quote</p>",
				text: "Quote",
				textHash: name,
				extractor: "test",
				extractorVersion: "1",
			})
			.returning()
		for (const kind of name === "source" ? ["old", "new", "deleted"] : [name]) {
			const [h] = await db
				.insert(highlights)
				.values({
					userId: uid,
					documentId: ids[name]!,
					versionId: version!.id,
					startOffset: 0,
					endOffset: 5,
					exact: "Quote",
					note: "highlight-only phrase",
					createdAt: new Date(kind === "new" ? "2026-09-12T00:00:00Z" : "2020-01-01T00:00:00Z"),
					updatedAt: sql`${kind === "new" ? "2026-09-12T00:00:00Z" : edited}::timestamptz`,
					deletedAt: kind === "deleted" ? new Date() : null,
				})
				.returning()
			highlightIds[kind] = h!.id
		}
	}
	await sync({
		userId,
		fromDocumentId: ids.source!,
		text: `${link(ids.target!)} ${link(ids.target!)} ${link(ids.trashed!)} ${link(ids.foreign!)}`,
	})
	for (const kind of ["old", "deleted"]) {
		await sync({
			userId,
			fromDocumentId: ids.source!,
			highlightId: highlightIds[kind]!,
			text: link(ids.target!),
		})
	}
	await sync({ userId, fromDocumentId: ids.trashed!, text: link(ids.target!) })
	// Even a malformed cache row cannot expose another user's article.
	await db.insert(documentLinks).values({
		userId,
		fromDocumentId: ids.foreign!,
		toDocumentId: ids.target!,
	})
})

afterAll(async () => {
	await db.delete(user).where(eq(user.id, userId))
	await db.delete(user).where(eq(user.id, otherUserId))
})

describe("library connection discovery", () => {
	it("lists live connections across views, once per note and target, with stable pages", async () => {
		const first = await listNoteLinks({ userId, limit: 1 })
		expect(first.items).toHaveLength(1)
		expect(first.nextCursor).toBeTruthy()
		const second = await listNoteLinks({ userId, limit: 1, cursor: first.nextCursor! })
		expect(second.items).toHaveLength(1)
		expect(second.nextCursor).toBeNull()
		const items = [...first.items, ...second.items]
		expect(new Set(items.map((i) => i.id)).size).toBe(2)
		for (const item of items) {
			expect(item.source.id).toBe(ids.source)
			expect(item.target.id).toBe(ids.target)
		}
		expect(items.map((i) => i.highlight?.id ?? null)).toEqual([highlightIds.old, null])
		expect((await listNoteLinks({ userId: otherUserId })).items).toEqual([])
	})

	it("filters both ends of a connection in each view and before pagination", async () => {
		for (const view of ["inbox", "archive", "starred"] as const) {
			const page = await listDocuments({ userId, view, hasNoteLinks: true, limit: 1 })
			expect(page.items.map((i) => i.id)).toEqual([view === "inbox" ? ids.source : ids.target])
			expect(page.nextCursor).toBeNull()
		}
		const without: string[] = []
		let cursor: ReturnType<typeof decodeCursor> = null
		do {
			const page = await listDocuments({
				userId,
				view: "inbox",
				hasNoteLinks: false,
				limit: 1,
				cursor,
			})
			without.push(...page.items.map((i) => i.id))
			cursor = decodeCursor(page.nextCursor)
		} while (cursor)
		expect(without.sort()).toEqual([ids.isolated!, ids.cleared!].sort())
	})
})

describe("whole-article note search and retrieval", () => {
	it("finds note-only terms and quoted phrases, excluding trash and other users", async () => {
		const results = await searchDocuments({ userId, q: '"orbital compass"' })
		expect(results.items.map((i) => i.id)).toEqual([ids.source])
		expect((await searchDocuments({ userId, q: '"compass orbital"' })).items).toEqual([])
		const notes = await listArticleNotes({ userId, q: '"orbital compass"' })
		expect(notes.items.map((i) => i.id)).toEqual([ids.source])
		expect((await listArticleNotes({ userId, documentId: ids.foreign })).items).toEqual([])
	})

	it("pages notes at microsecond precision, including cleared notes and timestamp ties", async () => {
		const items = []
		let cursor = null
		do {
			const page = await listArticleNotes({
				userId,
				limit: 1,
				cursor,
				updatedSince: edited,
				updatedBefore: "2026-09-11T00:00:00Z",
			})
			items.push(...page.items)
			cursor = page.nextCursor
		} while (cursor)
		expect(items).toHaveLength(3)
		expect(new Set(items.map((i) => i.id)).size).toBe(3)
		expect(items[0]).toMatchObject({
			id: ids.cleared,
			note: null,
			updatedAt: "2026-09-10T12:00:00.123457Z",
		})
		expect(items.slice(1).map((i) => i.id)).toEqual([ids.source!, ids.target!].sort().reverse())
		expect((await listArticleNotes({ userId, updatedBefore: edited })).items).toEqual([])
		const exact = await listArticleNotes({ userId, documentId: ids.source, updatedSince: edited })
		expect(exact.items[0]?.updatedAt).toBe(edited)
	})

	it("does not count article state changes as note edits", async () => {
		await updateArticle(userId, ids.source!, { starred: true })
		const page = await listArticleNotes({ userId, documentId: ids.source })
		expect(page.items[0]?.updatedAt).toBe(edited)
	})
})

describe("incremental highlight retrieval", () => {
	it("finds edits to old highlights with inclusive since and exclusive before", async () => {
		const page = await listUserHighlights({
			userId,
			updatedSince: "2026-09-10T09:00:00.123456-03:00",
			updatedBefore: "2026-09-12T00:00:00Z",
		})
		expect(page.items.map((i) => i.id)).toEqual([highlightIds.old])
		expect(page.items[0]?.createdAt.toISOString()).toBe("2020-01-01T00:00:00.000Z")
		expect(page.items[0]?.updatedAt.toISOString()).toBe("2026-09-10T12:00:00.123Z")
		expect((await listUserHighlights({ userId, updatedBefore: edited })).items).toEqual([])
	})

	it("combines date, article and query filters and keeps them through pagination", async () => {
		const filters = {
			userId,
			q: "highlight-only",
			documentId: ids.source,
			updatedSince: edited,
			limit: 1,
		}
		const first = await listUserHighlights(filters)
		expect(first.items.map((i) => i.id)).toEqual([highlightIds.new])
		expect(first.nextCursor).toBeTruthy()
		const second = await listUserHighlights({ ...filters, cursor: first.nextCursor })
		expect(second.items.map((i) => i.id)).toEqual([highlightIds.old])
		expect(second.nextCursor).toBeNull()
		const created = await listUserHighlights({
			...filters,
			createdSince: "2026-09-12T00:00:00Z",
			createdBefore: "2026-09-13T00:00:00Z",
		})
		expect(created.items.map((i) => i.id)).toEqual([highlightIds.new])
		expect(
			(await listUserHighlights({ userId, documentId: ids.foreign, updatedSince: edited })).items,
		).toEqual([])
	})
})
