import { randomUUID } from "node:crypto"
import { gzipSync } from "node:zlib"
import { FAKE_FAIL } from "@klipstack/ai"
import {
	addUsage,
	and,
	db,
	documentRaw,
	documents,
	documentVersions,
	eq,
	monthOf,
	pool,
	sql,
	usageCounts,
	user,
} from "@klipstack/db"
import { stopBoss } from "@klipstack/queue"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.hoisted(() => {
	process.env.AI_FAKE = "1"
})
vi.mock("@klipstack/db", async (original) => ({
	...(await original<typeof import("@klipstack/db")>()),
	notifyDocumentEvent: async () => undefined,
}))

const { handleExtract } = await import("./extract")
const { handleTranslate, splitParts } = await import("./translate")

const userId = `translate-${randomUUID()}`
const { month } = monthOf()
const page = (title: string, words: string) =>
	`<!doctype html><html lang="en"><head><title>${title}</title></head><body><article><h1>${title}</h1>${`<p>${words} <a href="https://example.com/source">a source</a>, and <strong>bold words</strong>.</p>`.repeat(12)}</article></body></html>`

beforeAll(async () => {
	await db.insert(user).values({ id: userId, name: "Translate", email: `${userId}@example.com` })
})
afterAll(async () => {
	await db.execute(
		sql`delete from pgboss.job where data->>'versionId' in (select v.id::text from document_versions v join documents d on d.id = v.document_id where d.user_id = ${userId})`,
	)
	await db.delete(user).where(eq(user.id, userId))
	await stopBoss()
	await pool.end()
})

const capture = (documentId: string, title: string, words: string) =>
	db.insert(documentRaw).values({
		documentId,
		rawHtml: gzipSync(Buffer.from(page(title, words), "utf8")),
		finalUrl: "https://example.com/article",
		httpStatus: 200,
		contentType: "text/html",
		source: "extension",
		fetchedAt: new Date(),
	})

const extractJob = (documentId: string) =>
	({ data: { documentId }, retryCount: 0, retryLimit: 3 }) as Parameters<typeof handleExtract>[0]

/** An extracted article, waiting for its translation into Spanish (2 credits taken). */
async function waiting(title = "Two questions") {
	const [doc] = await db
		.insert(documents)
		.values({ userId, sourceUrl: `https://example.com/${randomUUID()}`, urlHash: randomUUID() })
		.returning()
	await capture(doc!.id, title, "Makers need long blocks of time to do their work well")
	await handleExtract(extractJob(doc!.id))
	const ready = await read(doc!.id)
	await db.update(documents).set({ translationStatus: "pending" }).where(eq(documents.id, doc!.id))
	await addUsage(db, userId, "translations", 2, month)
	const job = (retryCount = 0) =>
		({
			data: {
				documentId: doc!.id,
				sourceVersionId: ready!.currentVersionId!,
				language: "es",
				credits: 2,
				month,
			},
			retryCount,
			retryLimit: 2,
		}) as Parameters<typeof handleTranslate>[0]
	return { id: doc!.id, original: ready!.currentVersionId!, job }
}

const read = (id: string) => db.query.documents.findFirst({ where: eq(documents.id, id) })
const current = async (id: string) =>
	db.query.documentVersions.findFirst({
		where: eq(documentVersions.id, (await read(id))!.currentVersionId!),
	})
async function credits() {
	const [row] = await db
		.select({ count: usageCounts.count })
		.from(usageCounts)
		.where(
			and(
				eq(usageCounts.userId, userId),
				eq(usageCounts.metric, "translations"),
				eq(usageCounts.month, month),
			),
		)
	return row?.count ?? 0
}
const found = async (id: string, query: string) => {
	const { rows } = await db.execute<{ id: string }>(
		sql`select id from documents where id = ${id} and search @@ websearch_to_tsquery('simple', ${query})`,
	)
	return rows.length === 1
}

describe("handleTranslate", () => {
	it("shows the translation, with its title, language and markup, and keeps the original", async () => {
		const doc = await waiting()
		await handleTranslate(doc.job())
		const after = await read(doc.id)
		expect(after).toMatchObject({
			language: "es",
			originalVersionId: doc.original,
			translationStatus: null,
		})
		expect(after!.title).toMatch(/^este es/)
		const translation = await current(doc.id)
		expect(translation).toMatchObject({ translatedFromId: doc.original, extractor: "translation" })
		expect(translation!.html).toContain('<a href="https://example.com/source"')
		expect(translation!.html).toContain("<strong>")
		expect(translation!.text).toContain("traducido")
		// Found by the translation's words and the original's.
		expect(await found(doc.id, "traducido")).toBe(true)
		expect(await found(doc.id, "makers")).toBe(true)
	})

	it("gives the credits back and leaves the original shown when the last try fails", async () => {
		const doc = await waiting(`Broken ${FAKE_FAIL}`)
		const before = await credits()
		// A try with retries left fails, to be retried.
		await expect(handleTranslate(doc.job(0))).rejects.toThrow()
		expect((await read(doc.id))?.translationStatus).toBe("pending")
		await handleTranslate(doc.job(2))
		expect(await read(doc.id)).toMatchObject({
			translationStatus: "failed",
			currentVersionId: doc.original,
			originalVersionId: null,
			language: "en",
		})
		expect(await credits()).toBe(before - 2)
	})

	it("shows nothing, and gives the credits back, when a new capture landed meanwhile", async () => {
		const doc = await waiting()
		await capture(doc.id, "Two questions, revised", "Managers work in one hour slots all day long")
		await handleExtract(extractJob(doc.id))
		const before = await credits()
		await handleTranslate(doc.job())
		const after = await read(doc.id)
		expect(after!.currentVersionId).not.toBe(doc.original)
		expect(after).toMatchObject({ originalVersionId: null, translationStatus: "failed" })
		expect(await credits()).toBe(before - 2)
	})
})

describe("extracting a translated article again", () => {
	it("keeps the translation shown, and makes the new capture its original", async () => {
		const doc = await waiting()
		await handleTranslate(doc.job())
		const translated = await read(doc.id)
		await capture(doc.id, "Two questions, revised", "Managers work in one hour slots all day long")
		await handleExtract(extractJob(doc.id))
		const after = await read(doc.id)
		expect(after).toMatchObject({
			currentVersionId: translated!.currentVersionId,
			title: translated!.title,
			language: "es",
		})
		expect(after!.originalVersionId).not.toBe(doc.original)
		const original = await db.query.documentVersions.findFirst({
			where: eq(documentVersions.id, after!.originalVersionId!),
		})
		expect(original).toMatchObject({ title: "Two questions, revised", language: "en" })
		expect(await found(doc.id, "managers")).toBe(true)
		expect(await found(doc.id, "makers")).toBe(false)
	})
})

describe("splitParts", () => {
	const p = (words: number) => `<p>${"word ".repeat(words).trim()}</p>`

	it("cuts between blocks, about so many words a part, and keeps every block", () => {
		const html = [p(40), p(40), p(40), p(40)].join("")
		const parts = splitParts(html, 100)
		expect(parts).toEqual([p(40) + p(40), p(40) + p(40)])
	})

	it("opens up a container too long for one part, and keeps a short one whole", () => {
		expect(splitParts(`<div>${p(40)}${p(40)}</div>`, 100)).toEqual([`<div>${p(40)}${p(40)}</div>`])
		expect(splitParts(`<div>${p(80)}${p(80)}</div>`, 100)).toEqual([p(80), p(80)])
	})
})
