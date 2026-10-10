import { createHash } from "node:crypto"
import {
	db,
	documents,
	documentVersions,
	editionItems,
	editions,
	eq,
	highlights,
	inArray,
	readingCompletions,
	user as userTable,
} from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { purgeArticles, trashArticles } from "~/commands/articles.server"
import { createEdition } from "~/commands/editions.server"
import { AppError } from "~/lib/app-error"
import { hasUnpublishedChanges } from "~/lib/editions"
import { env } from "~/lib/env.server"
import { usageOf } from "~/lib/limits.server"
import { setNote } from "./documents.server"
import {
	addItem,
	addShortlist,
	createEdition as insertEdition,
	deleteEdition,
	editionNudge,
	snoozeNudge,
	editionNeighbors,
	type EditionRow,
	getEdition,
	listEditions,
	listShortlist,
	moveItem,
	parseSnapshot,
	publishEdition,
	refreshItem,
	removeItem,
	pickerDocuments,
	restoreItem,
	unpublishEdition,
	updateEdition,
	updateItem,
} from "./editions.server"
import { buildExport } from "./export.server"
import { deleteHighlight } from "./highlights.server"

const userId = `test-editions-${Date.now()}`
const otherId = `${userId}-other`
const timeZone = "Europe/Madrid"
const missingId = "0193a5f1-2c3d-7e4f-8a9b-0c1d2e3f4a5b"

/** The error code a call fails with, or "ok". */
const code = (promise: Promise<unknown>) =>
	promise.then(
		() => "ok",
		(error: unknown) => {
			if (!(error instanceof AppError)) throw error
			// A field past its limit is `invalid_<field>`, as the editor tells them apart.
			return error.code === "invalid_request"
				? `invalid_${String(error.details?.field)}`
				: error.code
		},
	)

async function addDocument(values: Partial<typeof documents.$inferInsert> & { sourceUrl: string }) {
	const [doc] = await db
		.insert(documents)
		.values({ userId, urlHash: `${userId}:${values.sourceUrl}`, status: "ready", ...values })
		.returning()
	return doc!
}

/** Highlights on the current version, as the reader makes them. Returns their ids in order. */
async function addHighlights(
	documentId: string,
	text: string,
	quotes: Array<{ exact: string; note?: string; orphaned?: boolean; createdAt?: Date }>,
) {
	const [version] = await db
		.insert(documentVersions)
		.values({
			documentId,
			version: 1,
			html: `<p>${text}</p>`,
			text,
			textHash: createHash("sha256").update(text).digest("hex"),
			extractor: "test",
			extractorVersion: "0",
		})
		.returning({ id: documentVersions.id })
	await db
		.update(documents)
		.set({ currentVersionId: version!.id })
		.where(eq(documents.id, documentId))
	const rows = await db
		.insert(highlights)
		.values(
			quotes.map((q) => {
				const start = text.indexOf(q.exact)
				return {
					documentId,
					userId,
					versionId: version!.id,
					startOffset: start,
					endOffset: start + q.exact.length,
					exact: q.exact,
					note: q.note ?? null,
					orphaned: q.orphaned ?? false,
					...(q.createdAt ? { createdAt: q.createdAt } : {}),
				}
			}),
		)
		.returning({ id: highlights.id, exact: highlights.exact })
	return Object.fromEntries(rows.map((r) => [r.exact, r.id]))
}

async function snapshotOf(id: string) {
	const [row] = await db
		.select({ published: editions.published })
		.from(editions)
		.where(eq(editions.id, id))
	return row?.published ? parseSnapshot(row.published) : null
}

let target: typeof documents.$inferSelect
let main: typeof documents.$inferSelect
let noted: typeof documents.$inferSelect
let short: typeof documents.$inferSelect
let files: typeof documents.$inferSelect
let trashed: typeof documents.$inferSelect
let late: typeof documents.$inferSelect
let quoteIds: Record<string, string>
let edition: EditionRow

beforeAll(async () => {
	await db.insert(userTable).values([
		{ id: userId, name: "Ada Reader", email: `${userId}@example.com` },
		{ id: otherId, name: "Other", email: `${otherId}@example.com` },
	])
	target = await addDocument({ sourceUrl: "https://b.example/Mercury_(planet)", title: "Target" })
	trashed = await addDocument({
		sourceUrl: "https://t.example/",
		deletedAt: new Date(),
		// Active lately, but in the trash: never suggested.
		starredAt: new Date("2026-09-15T10:00:00Z"),
	})
	files = await addDocument({ sourceUrl: "ftp://files.example/a", title: "Files" })
	main = await addDocument({
		sourceUrl: "https://a.example/post?utm_source=feed",
		canonicalUrl: "https://a.example/post",
		title: "  Main article ",
		author: "Grace",
		siteName: "A Example",
		description: "About things.",
		leadImageUrl: "https://img.example/a.jpg",
		readingMinutes: 8,
		wordCount: 1000,
		// 00:30 on the 14th in Madrid: after the last publish (`previous`), though still the 13th in
		// UTC.
		starredAt: new Date("2026-09-13T22:30:00Z"),
		readAt: new Date("2026-09-25T10:00:00Z"),
		note:
			`See [Target](/read/${target.id}) and [Gone](/read/${trashed.id}), ` +
			`[Missing](/read/${missingId}) and [Files](/read/${files.id}).`,
		noteUpdatedAt: new Date("2026-09-01T10:00:00Z"),
	})
	quoteIds = await addHighlights(
		main.id,
		"Alpha one two three. Bravo four five. Charlie six. Echo eight. Foxtrot nine.",
		[
			{ exact: "Bravo four five.", note: `Links to [Target](/read/${target.id})` },
			{ exact: "Alpha one two three." },
			{ exact: "Charlie six.", orphaned: true },
			{ exact: "Echo eight.", createdAt: new Date("2026-09-15T09:00:00Z") },
			{ exact: "Foxtrot nine." },
		],
	)
	await db.insert(readingCompletions).values([
		{
			documentId: main.id,
			userId,
			cycle: 0,
			completedAt: new Date("2026-09-16T10:00:00Z"),
			source: "manual",
		},
		{
			documentId: main.id,
			userId,
			cycle: 1,
			completedAt: new Date("2026-09-25T10:00:00Z"),
			source: "manual",
		},
	])
	noted = await addDocument({
		sourceUrl: "https://n.example/",
		title: "Noted",
		note: "Worth a read.",
		noteUpdatedAt: new Date("2026-09-18T12:00:00Z"),
		// 00:30 on 2 August in Madrid.
		readAt: new Date("2026-08-01T22:30:00Z"),
	})
	short = await addDocument({ sourceUrl: "https://s.example/", title: "Short", wordCount: 50 })
	await addHighlights(short.id, "one two three four five six", [
		{ exact: "one two three" },
		{ exact: "four five six" },
	])
	late = await addDocument({
		sourceUrl: "https://late.example/",
		starredAt: new Date("2026-09-20T22:30:00Z"),
	})
	// 23:30 on the 13th in Madrid: before the last publish (`previous`).
	await addDocument({
		sourceUrl: "https://early.example/",
		starredAt: new Date("2026-09-13T21:30:00Z"),
	})
})

afterAll(async () => {
	await db.delete(userTable).where(inArray(userTable.id, [userId, otherId]))
})

describe("createEdition", () => {
	it("creates an untitled draft with a public id", async () => {
		edition = await insertEdition(userId, { locale: "en", timeZone })
		expect(edition).toMatchObject({ title: null, locale: "en", timeZone, publishedAt: null })
		expect(edition.publicId).toMatch(/^[0-9A-Za-z]{12}$/)
	})

	it("refuses a language Klipstack lacks", async () => {
		expect(await code(insertEdition(userId, { locale: "fr", timeZone }))).toBe("invalid_locale")
	})
})

describe("updateEdition", () => {
	it("takes a title, and blank for none", async () => {
		const blank = await insertEdition(userId, { locale: "en", timeZone })
		try {
			expect((await updateEdition(userId, blank.id, { title: "  Good   reads " })).title).toBe(
				"Good reads",
			)
			expect((await updateEdition(userId, blank.id, { title: " " })).title).toBeNull()
			expect((await updateEdition(userId, blank.id, { title: null })).title).toBeNull()
			expect(await code(updateEdition(userId, blank.id, { title: "x".repeat(201) }))).toBe(
				"invalid_title",
			)
		} finally {
			await deleteEdition(userId, blank.id)
		}
		edition = await updateEdition(userId, edition.id, { title: "Good reads, autumn" })
	})
})

/** Marks articles for the next edition, at these times, or takes the mark off (null). */
async function mark(marks: Array<[string, string | null]>) {
	for (const [id, at] of marks)
		await db
			.update(documents)
			.set({ shortlistedAt: at === null ? null : new Date(at) })
			.where(eq(documents.id, id))
}

describe("pickerDocuments", () => {
	const lately = async (editionId: string) =>
		(await pickerDocuments(userId, editionId)).lately.map((d) => d.id)
	// The user's edition before this one, first published at midnight on the 14th in Madrid.
	let previous: string
	beforeAll(async () => {
		const [row] = await db
			.insert(editions)
			.values({ userId, locale: "en", timeZone, publishedAt: new Date("2026-09-13T22:00:00Z") })
			.returning({ id: editions.id })
		previous = row!.id
		await db.insert(readingCompletions).values(
			[
				// Before the last publish: not read lately.
				[target, "2026-09-13T21:00:00Z"],
				[late, "2026-09-21T10:00:00Z"],
				[short, "2026-09-22T10:00:00Z"],
			].map(([doc, at]) => ({
				documentId: (doc as typeof target).id,
				userId,
				cycle: 0,
				completedAt: new Date(at as string),
				source: "manual" as const,
			})),
		)
	})
	afterAll(async () => {
		await db.delete(editions).where(eq(editions.id, previous))
		await db
			.delete(readingCompletions)
			.where(inArray(readingCompletions.documentId, [target.id, late.id, short.id]))
	})

	it("offers what was finished since the last publish: starred first, then the latest", async () => {
		const { shortlist, lately: read } = await pickerDocuments(userId, edition.id)
		expect(shortlist).toEqual([])
		expect(read.map((d) => d.id)).toEqual([main.id, late.id, short.id])
		expect(read[0]).toEqual({
			id: main.id,
			title: "  Main article ",
			siteName: "A Example",
			url: "https://a.example/post",
			finished: true,
			starred: true,
			highlights: 5,
			note: true,
			added: false,
		})
	})

	it("leaves out what another published edition shared", async () => {
		const [item] = await db
			.insert(editionItems)
			.values({
				editionId: previous,
				documentId: short.id,
				position: 0,
				url: "https://s.example/",
				title: "Short",
			})
			.returning({ id: editionItems.id })
		try {
			expect(await lately(edition.id)).toEqual([main.id, late.id])
		} finally {
			await db.delete(editionItems).where(eq(editionItems.id, item!.id))
		}
	})

	it("puts the marked ones in the shortlist, the latest mark first, and out of the rest", async () => {
		await mark([
			[noted.id, "2026-09-01T10:00:00Z"],
			[late.id, "2026-09-02T10:00:00Z"],
		])
		try {
			const { shortlist, lately: read } = await pickerDocuments(userId, edition.id)
			expect(shortlist.map((d) => d.id)).toEqual([late.id, noted.id])
			expect(shortlist[1]).toMatchObject({ finished: true, note: true, starred: false })
			expect(read.map((d) => d.id)).toEqual([main.id, short.id])
		} finally {
			await mark([
				[noted.id, null],
				[late.id, null],
			])
		}
	})

	it("looks back from the edition before, once this one is published too", async () => {
		// First published at midnight on the 22nd in Madrid: after `late` was finished, before `short`.
		const [row] = await db
			.insert(editions)
			.values({ userId, locale: "en", timeZone, publishedAt: new Date("2026-09-21T22:00:00Z") })
			.returning({ id: editions.id })
		try {
			expect(await lately(edition.id)).toEqual([main.id, short.id])
			expect(await lately(row!.id)).toEqual([main.id, late.id, short.id])
		} finally {
			await db.delete(editions).where(eq(editions.id, row!.id))
		}
	})

	it("looks back 30 days before the first publish", async () => {
		const day = 86_400_000
		const add = async (url: string, daysAgo: number) => {
			const [doc] = await db
				.insert(documents)
				.values({ userId: otherId, sourceUrl: url, urlHash: `${otherId}:${url}`, status: "ready" })
				.returning({ id: documents.id })
			await db.insert(readingCompletions).values({
				documentId: doc!.id,
				userId: otherId,
				cycle: 0,
				completedAt: new Date(Date.now() - daysAgo * day),
				source: "manual",
			})
			return doc!.id
		}
		const recent = await add("https://recent.example/", 29)
		await add("https://old.example/", 31)
		const first = await insertEdition(otherId, { locale: "en", timeZone })
		try {
			expect((await pickerDocuments(otherId, first.id)).lately.map((d) => d.id)).toEqual([recent])
		} finally {
			await deleteEdition(otherId, first.id)
		}
	})
})

describe("the shortlist in editions", () => {
	it("starts a new edition, the oldest mark first; an article with no web address stays out", async () => {
		await mark([
			[target.id, "2026-09-03T10:00:00Z"],
			[files.id, "2026-09-02T10:00:00Z"],
			[noted.id, "2026-09-01T10:00:00Z"],
		])
		const draft = await createEdition(userId, { locale: "en", timeZone })
		try {
			const { items } = await getEdition(userId, draft.id)
			expect(items.map((i) => [i.position, i.documentId])).toEqual([
				[0, noted.id],
				[1, target.id],
			])
			expect((await listShortlist(userId)).map((e) => e.id)).toEqual([
				target.id,
				files.id,
				noted.id,
			])
			// Three marked: an edition by themselves, before any was published.
			expect(await editionNudge(userId)).toMatchObject({
				marked: 3,
				daysSince: null,
				reason: "marked",
			})
			// "Not now" quiets it for a week.
			await snoozeNudge(userId)
			expect((await editionNudge(userId)).reason).toBeNull()
			expect((await editionNudge(userId, new Date(Date.now() + 8 * 86_400_000))).reason).toBe(
				"marked",
			)
			await db.update(userTable).set({ prefs: {} }).where(eq(userTable.id, userId))
			// Marked later: Add all brings it, and nothing twice.
			await mark([[short.id, "2026-09-04T10:00:00Z"]])
			expect(
				(await pickerDocuments(userId, draft.id)).shortlist.filter((d) => !d.added),
			).toHaveLength(2)
			expect(await addShortlist(userId, draft.id)).toBe(1)
			expect(await addShortlist(userId, draft.id)).toBe(0)
		} finally {
			await deleteEdition(userId, draft.id)
		}
	})

	it("deleting a draft keeps the marks; removing an item takes its mark off, and undo puts both back", async () => {
		const marks = await listShortlist(userId)
		expect(marks.map((e) => e.id)).toEqual([short.id, target.id, files.id, noted.id])
		const draft = await createEdition(userId, { locale: "en", timeZone })
		try {
			const before = await getEdition(userId, draft.id)
			const targetItem = before.items.find((i) => i.documentId === target.id)!
			const removed = await removeItem(userId, draft.id, targetItem.id)
			expect(removed.shortlistedAt).toMatch(/^2026-09-03 /)
			expect((await listShortlist(userId)).map((e) => e.id)).not.toContain(target.id)
			await restoreItem(userId, draft.id, removed)
			// Twice is once.
			await restoreItem(userId, draft.id, removed)
			expect((await getEdition(userId, draft.id)).items).toEqual(before.items)
			const back = (await listShortlist(userId)).find((e) => e.id === target.id)
			expect(back?.shortlistedAt).toEqual(new Date("2026-09-03T10:00:00Z"))
		} finally {
			await mark([
				[short.id, null],
				[target.id, null],
				[files.id, null],
				[noted.id, null],
			])
			await deleteEdition(userId, draft.id)
		}
	})
})

describe("addItem", () => {
	it("copies the article, with nothing included", async () => {
		const item = await addItem(userId, edition.id, main.id)
		expect(item).toMatchObject({
			documentId: main.id,
			position: 0,
			url: "https://a.example/post",
			title: "Main article",
			author: "Grace",
			siteName: "A Example",
			description: "About things.",
			leadImageUrl: "https://img.example/a.jpg",
			readingMinutes: 8,
			wordCount: 1000,
			// The last completion.
			readOn: "2026-09-25",
			includeNote: false,
		})
		// In reading order, without the orphaned one.
		expect(item.highlights.map((h) => [h.exact, h.included])).toEqual([
			["Alpha one two three.", false],
			["Bravo four five.", false],
			["Echo eight.", false],
			["Foxtrot nine.", false],
		])
		await mark([[main.id, "2026-09-05T10:00:00Z"]])
		expect((await pickerDocuments(userId, edition.id)).shortlist).toMatchObject([
			{ id: main.id, added: true },
		])
	})

	it("points note links at the articles' own addresses, or drops them", async () => {
		const { items } = await getEdition(userId, edition.id)
		const [item] = items
		// Trashed, missing and non-http targets keep only their text. Parentheses are escaped.
		expect(item!.note).toBe(
			"See [Target](https://b.example/Mercury_%28planet%29) and Gone, Missing and Files.",
		)
		expect(item!.highlights[1]!.note).toBe(
			"Links to [Target](https://b.example/Mercury_%28planet%29)",
		)
		expect(JSON.stringify(item)).not.toContain("/read/")
	})

	it("dates an article with no completion by when it was read", async () => {
		const item = await addItem(userId, edition.id, noted.id)
		expect(item).toMatchObject({ position: 1, readOn: "2026-08-02", note: "Worth a read." })
		expect((await addItem(userId, edition.id, short.id)).position).toBe(2)
	})

	it("refuses an article twice, one without a web address, and one that is not there", async () => {
		expect(await code(addItem(userId, edition.id, main.id))).toBe("already_added")
		expect(await code(addItem(userId, edition.id, files.id))).toBe("no_url")
		expect(await code(addItem(userId, edition.id, trashed.id))).toBe("not_found")
		expect(await code(addItem(userId, edition.id, missingId))).toBe("not_found")
		expect(await code(addItem(userId, edition.id, "nope"))).toBe("not_found")
	})
})

describe("updateItem", () => {
	const itemOf = async (documentId: string) =>
		(await getEdition(userId, edition.id)).items.find((i) => i.documentId === documentId)!

	it("includes the note and edits the edition's copy only", async () => {
		const item = await itemOf(main.id)
		const saved = await updateItem(userId, edition.id, item.id, {
			includeNote: true,
			note: "My own words.\r\nSecond line.  ",
		})
		expect(saved).toMatchObject({ includeNote: true, note: "My own words.\nSecond line." })
		const [library] = await db.select().from(documents).where(eq(documents.id, main.id))
		expect(library!.note).toContain("[Target]")
	})

	it("includes up to 3 highlights, and edits their notes", async () => {
		const item = await itemOf(main.id)
		const saved = await updateItem(userId, edition.id, item.id, {
			highlights: [
				{ highlightId: quoteIds["Alpha one two three."]!, included: true },
				{ highlightId: quoteIds["Bravo four five."]!, included: true, note: "Edited." },
				{ highlightId: quoteIds["Echo eight."]!, included: true },
				{ highlightId: missingId, included: true },
			],
		})
		expect(saved.highlights.map((h) => [h.included, h.note])).toEqual([
			[true, null],
			[true, "Edited."],
			[true, null],
			[false, null],
		])
		const fourth = { highlightId: quoteIds["Foxtrot nine."]!, included: true }
		const error = await updateItem(userId, edition.id, item.id, { highlights: [fourth] }).catch(
			(e: unknown) => e,
		)
		expect(error).toMatchObject({ code: "quote_cap", details: { quoteProblem: "too-many" } })
	})

	it("refuses quotes longer than a tenth of the article", async () => {
		const item = await itemOf(short.id)
		const [first, second] = item.highlights
		await updateItem(userId, edition.id, item.id, {
			highlights: [{ highlightId: first!.highlightId, included: true }],
		})
		const error = await updateItem(userId, edition.id, item.id, {
			highlights: [{ highlightId: second!.highlightId, included: true }],
		}).catch((e: unknown) => e)
		expect(error).toMatchObject({ code: "quote_cap", details: { quoteProblem: "too-long" } })
	})

	it("changes nothing, not even the date, when nothing changed", async () => {
		const before = (await getEdition(userId, edition.id)).edition.updatedAt
		const item = await itemOf(main.id)
		await updateItem(userId, edition.id, item.id, { includeNote: true })
		expect((await getEdition(userId, edition.id)).edition.updatedAt).toEqual(before)
	})
})

describe("moveItem and removeItem", () => {
	const order = async () =>
		(await getEdition(userId, edition.id)).items.map((i) => [i.position, i.title])

	it("swaps neighbours and keeps positions without gaps", async () => {
		const { items } = await getEdition(userId, edition.id)
		const [first, , last] = items
		await moveItem(userId, edition.id, last!.id, "up")
		expect(await order()).toEqual([
			[0, "Main article"],
			[1, "Short"],
			[2, "Noted"],
		])
		await moveItem(userId, edition.id, first!.id, "up")
		expect((await order())[0]).toEqual([0, "Main article"])
		await removeItem(userId, edition.id, last!.id)
		expect(await order()).toEqual([
			[0, "Main article"],
			[1, "Noted"],
		])
		expect(await code(removeItem(userId, edition.id, last!.id))).toBe("not_found")
	})
})

describe("publishEdition", () => {
	it("refuses a working copy that cannot go public, and says why", async () => {
		const empty = await insertEdition(userId, { locale: "es", timeZone })
		expect(await publishEdition(userId, empty.id)).toEqual({
			ok: false,
			problems: [{ code: "no_items" }],
		})
		expect(await snapshotOf(empty.id)).toBeNull()
		await deleteEdition(userId, empty.id)
	})

	it("writes the snapshot: only what the user included, nothing of the library", async () => {
		// Marked when it was added: shared now, so off the shortlist.
		expect((await listShortlist(userId)).map((e) => e.id)).toEqual([main.id])
		const published = await publishEdition(userId, edition.id)
		expect(await listShortlist(userId)).toEqual([])
		expect(published.ok).toBe(true)
		if (!published.ok) return
		expect(published.edition.publishedAt).toBeInstanceOf(Date)
		expect(published.edition.republishedAt).toBeNull()
		expect(hasUnpublishedChanges(published.edition)).toBe(false)
		const snapshot = await snapshotOf(edition.id)
		expect(snapshot).toMatchObject({
			v: 1,
			title: "Good reads, autumn",
			intro: null,
			authorName: "Ada Reader",
			locale: "en",
		})
		expect(snapshot!.items).toEqual([
			{
				url: "https://a.example/post",
				title: "Main article",
				author: "Grace",
				siteName: "A Example",
				description: "About things.",
				leadImageUrl: "https://img.example/a.jpg",
				readingMinutes: 8,
				readOn: "2026-09-25",
				note: "My own words.\nSecond line.",
				highlights: [
					{ exact: "Alpha one two three.", note: null },
					{ exact: "Bravo four five.", note: "Edited." },
					{ exact: "Echo eight.", note: null },
				],
			},
			{
				url: "https://n.example/",
				title: "Noted",
				author: null,
				siteName: null,
				description: null,
				leadImageUrl: null,
				readingMinutes: null,
				readOn: "2026-08-02",
				// Not included.
				note: null,
				highlights: [],
			},
		])
	})

	it("nudges two weeks later only with something to share", async () => {
		// A minute past fifteen days: the database's clock may run a few milliseconds ahead of this one.
		const later = new Date(Date.now() + 15 * 86_400_000 + 60_000)
		// Published just now, its marks cleared, nothing read since: time alone is no reason.
		expect(await editionNudge(userId, later)).toMatchObject({
			marked: 0,
			daysSince: 15,
			readSince: 0,
			reason: null,
		})
		await mark([[target.id, new Date().toISOString()]])
		try {
			expect((await editionNudge(userId)).reason).toBeNull()
			expect((await editionNudge(userId, later)).reason).toBe("stale")
		} finally {
			await mark([[target.id, null]])
		}
	})

	it("leaves the public page alone while the working copy changes", async () => {
		const before = await snapshotOf(edition.id)
		const updated = await updateEdition(userId, edition.id, { intro: "What I read.\r\n\r\nMore." })
		expect(updated.intro).toBe("What I read.\n\nMore.")
		expect(hasUnpublishedChanges(updated)).toBe(true)
		expect(await snapshotOf(edition.id)).toEqual(before)
	})

	it("rewrites it on Update", async () => {
		const updated = await publishEdition(userId, edition.id)
		if (!updated.ok) throw new Error("not published")
		expect(updated.edition.republishedAt).toBeInstanceOf(Date)
		expect(hasUnpublishedChanges(updated.edition)).toBe(false)
		expect((await snapshotOf(edition.id))!.intro).toBe("What I read.\n\nMore.")
	})

	it("checks the quote cap again", async () => {
		const { items } = await getEdition(userId, edition.id)
		// As if a refresh brought a shorter word count.
		await db.update(editionItems).set({ wordCount: 50 }).where(eq(editionItems.id, items[0]!.id))
		await updateEdition(userId, edition.id, { title: "Good reads" })
		expect(await publishEdition(userId, edition.id)).toEqual({
			ok: false,
			problems: [{ code: "quotes", itemId: items[0]!.id, problem: "too-long" }],
		})
		await db.update(editionItems).set({ wordCount: 1000 }).where(eq(editionItems.id, items[0]!.id))
		expect((await publishEdition(userId, edition.id)).ok).toBe(true)
	})

	it("counts only a first publish against the monthly cap", async () => {
		const used = (await usageOf(userId)).editions.used
		expect(used).toBe(1)
		const before = env.LIMIT_EDITIONS_PER_MONTH
		env.LIMIT_EDITIONS_PER_MONTH = used
		const next = await insertEdition(userId, { locale: "es", timeZone })
		try {
			// Updating the public page, twice, takes nothing from the cap.
			for (const title of ["Good reads, again", "Good reads"]) {
				await updateEdition(userId, edition.id, { title })
				expect((await publishEdition(userId, edition.id)).ok).toBe(true)
			}
			await addItem(userId, next.id, main.id)
			expect(await code(publishEdition(userId, next.id))).toBe("limit_reached")
			expect(await snapshotOf(next.id)).toBeNull()
			expect((await usageOf(userId)).editions.used).toBe(used)
		} finally {
			env.LIMIT_EDITIONS_PER_MONTH = before
			await deleteEdition(userId, next.id)
		}
	})
})

describe("an edition without a title", () => {
	it("publishes, with the day of its first publish as its address", async () => {
		const untitled = await insertEdition(userId, { locale: "en", timeZone })
		try {
			await addItem(userId, untitled.id, main.id)
			const published = await publishEdition(userId, untitled.id)
			if (!published.ok) throw new Error("not published")
			expect((await snapshotOf(untitled.id))!.title).toBeNull()
			const day = new Intl.DateTimeFormat("en-CA", { timeZone }).format(
				published.edition.publishedAt!,
			)
			expect((await getEdition(userId, untitled.id)).publicPath).toBe(
				`/e/${untitled.publicId}/${day}`,
			)
		} finally {
			await deleteEdition(userId, untitled.id)
		}
	})
})

describe("unpublishEdition", () => {
	it("hides the page, keeps the snapshot, and brings it back unchanged", async () => {
		const snapshot = await snapshotOf(edition.id)
		const { edition: before } = await getEdition(userId, edition.id)
		const hidden = await unpublishEdition(userId, edition.id)
		expect(hidden.unpublishedAt).toBeInstanceOf(Date)
		expect(await snapshotOf(edition.id)).toEqual(snapshot)
		const back = await publishEdition(userId, edition.id)
		if (!back.ok) throw new Error("not published")
		expect(back.edition.unpublishedAt).toBeNull()
		// Nothing changed meanwhile: not an update.
		expect(back.edition.republishedAt).toEqual(before.republishedAt)
	})

	it("refuses a draft", async () => {
		const draft = await insertEdition(userId, { locale: "en", timeZone })
		expect(await code(unpublishEdition(userId, draft.id))).toBe("not_published")
		await deleteEdition(userId, draft.id)
	})
})

describe("refreshItem", () => {
	it("copies the article again and keeps the selection that still exists", async () => {
		await db.update(documents).set({ title: "Main, revised" }).where(eq(documents.id, main.id))
		await setNote(userId, main.id, "A new note.")
		await deleteHighlight(userId, quoteIds["Bravo four five."]!)
		const { items } = await getEdition(userId, edition.id)
		const item = await refreshItem(userId, edition.id, items[0]!.id)
		expect(item).toMatchObject({ title: "Main, revised", note: "A new note.", includeNote: true })
		expect(item.highlights.map((h) => [h.exact, h.included])).toEqual([
			["Alpha one two three.", true],
			["Echo eight.", true],
			["Foxtrot nine.", false],
		])
	})

	it("keeps the item when its article is deleted, and has nothing to refresh from", async () => {
		const { items } = await getEdition(userId, edition.id)
		const notedItem = items.find((i) => i.documentId === noted.id)!
		await trashArticles(userId, [noted.id])
		expect(await code(refreshItem(userId, edition.id, notedItem.id))).toBe("document_gone")
		await purgeArticles(userId, [noted.id])
		const after = (await getEdition(userId, edition.id)).items.find((i) => i.id === notedItem.id)
		expect(after).toMatchObject({ documentId: null, title: "Noted", url: "https://n.example/" })
		expect(await code(refreshItem(userId, edition.id, notedItem.id))).toBe("document_gone")
	})
})

describe("owner scoping", () => {
	it("finds nothing of another user's editions", async () => {
		const { items } = await getEdition(userId, edition.id)
		const itemId = items[0]!.id
		const calls: Array<() => Promise<unknown>> = [
			() => getEdition(otherId, edition.id),
			() => pickerDocuments(otherId, edition.id),
			() => updateEdition(otherId, edition.id, { title: "Mine" }),
			() => addItem(otherId, edition.id, main.id),
			() => updateItem(otherId, edition.id, itemId, { includeNote: false }),
			() => moveItem(otherId, edition.id, itemId, "down"),
			() => removeItem(otherId, edition.id, itemId),
			() => refreshItem(otherId, edition.id, itemId),
			() => publishEdition(otherId, edition.id),
			() => unpublishEdition(otherId, edition.id),
			() => deleteEdition(otherId, edition.id),
		]
		for (const call of calls) expect(await code(call())).toBe("not_found")
		expect(await listEditions(otherId)).toEqual([])
	})

	it("does not add another user's article", async () => {
		const mine = await insertEdition(otherId, { locale: "en", timeZone })
		await updateEdition(otherId, mine.id, { title: "Mine" })
		expect(await code(addItem(otherId, mine.id, main.id))).toBe("not_found")
		// Nor an item of one edition through another.
		const { items } = await getEdition(userId, edition.id)
		expect(await code(removeItem(otherId, mine.id, items[0]!.id))).toBe("not_found")
	})
})

describe("editionNeighbors", () => {
	it("links the author's live editions before and after, only when the author says so", async () => {
		const published = (title: string | null, at: string, extra = {}) =>
			db
				.insert(editions)
				.values({
					userId: otherId,
					title,
					locale: "en",
					timeZone: "UTC",
					published: { v: 1, title, intro: null, authorName: "Other", locale: "en", items: [] },
					publishedAt: new Date(at),
					...extra,
				})
				.returning({ id: editions.id, publicId: editions.publicId })
				.then(([row]) => row!)
		const first = await published("First", "2026-09-01T10:00:00Z")
		const hidden = await published("Hidden", "2026-09-05T10:00:00Z", {
			unpublishedAt: new Date("2026-09-06T10:00:00Z"),
		})
		const middle = await published(null, "2026-09-10T10:00:00Z")
		const removed = await published("Removed", "2026-09-12T10:00:00Z", {
			unpublishedAt: new Date("2026-09-13T10:00:00Z"),
			removedAt: new Date("2026-09-13T10:00:00Z"),
		})
		const last = await published("Last", "2026-09-20T10:00:00Z")
		const at = { id: middle.id, publishedAt: new Date("2026-09-10T10:00:00Z") }
		try {
			// Off by default: each edition stands alone.
			expect(await editionNeighbors(otherId, at, "en")).toEqual({ previous: null, next: null })
			await db
				.update(userTable)
				.set({ prefs: { linkEditions: "on" } })
				.where(eq(userTable.id, otherId))
			expect(await editionNeighbors(otherId, at, "en")).toEqual({
				previous: { title: "First", path: `/e/${first.publicId}/first` },
				next: { title: "Last", path: `/e/${last.publicId}/last` },
			})
			// An untitled one goes by its date, in the language of the page that links to it.
			const fromLast = await editionNeighbors(
				otherId,
				{ id: last.id, publishedAt: new Date("2026-09-20T10:00:00Z") },
				"es",
			)
			expect(fromLast).toEqual({
				previous: { title: "10 de septiembre de 2026", path: `/e/${middle.publicId}/2026-09-10` },
				next: null,
			})
		} finally {
			await db.update(userTable).set({ prefs: {} }).where(eq(userTable.id, otherId))
			await db
				.delete(editions)
				.where(inArray(editions.id, [first.id, hidden.id, middle.id, removed.id, last.id]))
		}
	})
})

describe("listEditions and deleteEdition", () => {
	it("lists the user's editions with their item counts and public addresses", async () => {
		expect(await listEditions(userId)).toEqual([
			expect.objectContaining({
				id: edition.id,
				title: "Good reads",
				itemCount: 2,
				// The published title, not the working copy's.
				publicPath: `/e/${edition.publicId}/good-reads`,
			}),
		])
		const draft = await insertEdition(userId, { locale: "en", timeZone })
		expect((await getEdition(userId, draft.id)).publicPath).toBeNull()
		await deleteEdition(userId, draft.id)
	})

	it("go into the export: the working copy, and the snapshot as published", async () => {
		const [exported, ...others] = (await buildExport(userId)).editions
		expect(others).toEqual([])
		expect(exported).toMatchObject({
			id: edition.id,
			publicId: edition.publicId,
			title: "Good reads",
			intro: "What I read.\n\nMore.",
			publishedAt: expect.any(String),
			unpublishedAt: null,
			published: { v: 1, title: "Good reads", authorName: "Ada Reader" },
		})
		// The working copy is newer than the snapshot: the refresh came after the last publish.
		expect(exported!.items.map((item) => [item.title, item.documentId])).toEqual([
			["Main, revised", main.id],
			["Noted", null],
		])
		expect(exported!.published!.items[0]!.title).toBe("Main article")
		expect(exported!.items[0]!.highlights[0]).toEqual({
			highlightId: quoteIds["Alpha one two three."],
			exact: "Alpha one two three.",
			note: null,
			included: true,
		})
		// Another user's are theirs.
		expect((await buildExport(otherId)).editions.map((e) => e.title)).toEqual(["Mine"])
	})

	it("deletes the edition and its items", async () => {
		await deleteEdition(userId, edition.id)
		expect(await code(getEdition(userId, edition.id))).toBe("not_found")
		const left = await db.select().from(editionItems).where(eq(editionItems.editionId, edition.id))
		expect(left).toEqual([])
		expect(await code(deleteEdition(userId, edition.id))).toBe("not_found")
	})
})
