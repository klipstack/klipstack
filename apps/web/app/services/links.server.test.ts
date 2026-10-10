import { createHash, randomUUID } from "node:crypto"
import {
	db,
	documentLinks,
	documentOutlinks,
	documents,
	documentVersions,
	eq,
	highlights,
	user as userTable,
} from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { setNote } from "./documents.server"
import {
	linkTargetDetails,
	linkTargetStatus,
	listBacklinks,
	listContentLinks,
	syncNoteLinks,
} from "./links.server"

/** Link rows as a note save writes them: in the save's transaction. */
const sync = (note: Parameters<typeof syncNoteLinks>[0]) =>
	db.transaction((tx) => syncNoteLinks(note, tx))

const userId = `test-links-${Date.now()}`
const otherUserId = `${userId}-other`
let source: string
let target: string
let foreign: string
let versionId: string

async function addDocument(uid: string, title: string): Promise<string> {
	const [d] = await db
		.insert(documents)
		.values({
			userId: uid,
			sourceUrl: `https://example.com/${title}`,
			urlHash: `${uid}-${title}`,
			title,
			status: "ready",
		})
		.returning({ id: documents.id })
	return d!.id
}

const link = (id: string) => `[T](/read/${id})`

beforeAll(async () => {
	await db.insert(userTable).values([
		{ id: userId, name: "Links", email: `${userId}@example.com` },
		{ id: otherUserId, name: "Other", email: `${otherUserId}@example.com` },
	])
	source = await addDocument(userId, "source")
	target = await addDocument(userId, "target")
	foreign = await addDocument(otherUserId, "foreign")
	const text = "Alpha bravo charlie."
	const [v] = await db
		.insert(documentVersions)
		.values({
			documentId: source,
			version: 1,
			html: `<p>${text}</p>`,
			text,
			textHash: createHash("sha256").update(text).digest("hex"),
			extractor: "test",
			extractorVersion: "0",
		})
		.returning({ id: documentVersions.id })
	versionId = v!.id
})

afterAll(async () => {
	await db.delete(userTable).where(eq(userTable.id, userId))
	await db.delete(userTable).where(eq(userTable.id, otherUserId))
})

async function targetsOf(fromDocumentId: string): Promise<string[]> {
	const rows = await db
		.select({ to: documentLinks.toDocumentId })
		.from(documentLinks)
		.where(eq(documentLinks.fromDocumentId, fromDocumentId))
	return rows.map((r) => r.to)
}

describe("syncNoteLinks", () => {
	it("replaces the note's rows, dropping self links, foreign ids and repeats", async () => {
		await sync({
			userId,
			fromDocumentId: source,
			text: `${link(target)} ${link(target)} ${link(source)} ${link(foreign)}`,
		})
		expect(await targetsOf(source)).toEqual([target])

		await sync({ userId, fromDocumentId: source, text: "no links now" })
		expect(await targetsOf(source)).toEqual([])
	})

	it("leaves the links of the note that won when two saves race", async () => {
		for (let round = 0; round < 5; round++) {
			await Promise.all([
				setNote(userId, source, link(target)),
				setNote(userId, source, "no links"),
			])
			const saved = await db.query.documents.findFirst({ where: eq(documents.id, source) })
			expect(await targetsOf(source)).toEqual(saved?.note === "no links" ? [] : [target])
		}
		await setNote(userId, source, null)
	})

	it("keeps a link to an article in the trash", async () => {
		await db.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, target))
		await sync({ userId, fromDocumentId: source, text: link(target) })
		expect(await targetsOf(source)).toEqual([target])
		expect(await linkTargetStatus(userId, [target])).toEqual({ [target]: "trash" })
		await db.update(documents).set({ deletedAt: null }).where(eq(documents.id, target))
		expect(await linkTargetStatus(userId, [target])).toEqual({ [target]: "ok" })
		expect(await linkTargetStatus(userId, [foreign])).toEqual({})
	})

	it("looks up every target, however many links come before it", async () => {
		// 200 links to one article, then one to another (the lookup used to stop at 200 links).
		const repeated = [...Array.from({ length: 200 }, () => target), source]
		expect(await linkTargetStatus(userId, repeated)).toEqual({ [target]: "ok", [source]: "ok" })
		// More distinct targets than one query takes.
		const many = [...Array.from({ length: 1200 }, () => randomUUID()), source, foreign]
		expect(await linkTargetDetails(userId, many)).toEqual({
			[source]: { status: "ok", url: "https://example.com/source" },
		})
	})
})

describe("listBacklinks", () => {
	it("hides trashed sources and deleted highlights, and puts the newest link first", async () => {
		const [h] = await db
			.insert(highlights)
			.values({
				documentId: source,
				userId,
				versionId,
				startOffset: 0,
				endOffset: 5,
				exact: "Alpha",
				note: link(target),
			})
			.returning({ id: highlights.id })
		await sync({ userId, fromDocumentId: source, text: link(target) })
		await sync({ userId, fromDocumentId: source, highlightId: h!.id, text: link(target) })

		// The highlight's link was written last, so it comes first.
		expect(await listBacklinks(userId, target)).toEqual([
			{
				documentId: source,
				title: "source",
				sourceUrl: "https://example.com/source",
				highlightId: h!.id,
				exact: "Alpha",
			},
			{
				documentId: source,
				title: "source",
				sourceUrl: "https://example.com/source",
				highlightId: null,
				exact: null,
			},
		])

		await db.update(highlights).set({ deletedAt: new Date() }).where(eq(highlights.id, h!.id))
		expect(await listBacklinks(userId, target)).toHaveLength(1)

		await db.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, source))
		expect(await listBacklinks(userId, target)).toEqual([])
		await db.update(documents).set({ deletedAt: null }).where(eq(documents.id, source))
		expect(await listBacklinks(userId, target)).toHaveLength(1)
	})
})

describe("listContentLinks", () => {
	const ids = (list: Array<{ documentId: string }>) => list.map((l) => l.documentId)
	const outlink = (documentId: string, uid: string, title: string) =>
		db.insert(documentOutlinks).values({ documentId, userId: uid, urlHash: `${uid}-${title}` })
	let hub: string
	let later: string

	beforeAll(async () => {
		hub = await addDocument(userId, "hub")
		await outlink(hub, userId, "target")
		await outlink(hub, userId, "later")
		await outlink(hub, userId, "hub")
		// Another user's article at the same hash as this user's outlink connects nothing.
		await outlink(foreign, otherUserId, "target")
	})

	it("lists both ways, without the article itself or other users' articles", async () => {
		expect(ids((await listContentLinks(userId, hub)).to)).toEqual([target])
		const links = await listContentLinks(userId, target)
		expect(ids(links.from)).toEqual([hub])
		expect(links.to).toEqual([])
		expect(await listContentLinks(otherUserId, target)).toEqual({ to: [], from: [] })
	})

	it("connects an article saved after the one that links to it", async () => {
		later = await addDocument(userId, "later")
		expect(ids((await listContentLinks(userId, hub)).to)).toEqual([later, target])
		expect(ids((await listContentLinks(userId, later)).from)).toEqual([hub])
	})

	it("hides articles in the trash, at either end, and brings them back", async () => {
		const trash = (id: string, deletedAt: Date | null) =>
			db.update(documents).set({ deletedAt }).where(eq(documents.id, id))
		await trash(later, new Date())
		expect(ids((await listContentLinks(userId, hub)).to)).toEqual([target])
		await trash(later, null)
		await trash(hub, new Date())
		expect((await listContentLinks(userId, target)).from).toEqual([])
		await trash(hub, null)
		expect(ids((await listContentLinks(userId, target)).from)).toEqual([hub])
	})
})
