import { createHash } from "node:crypto"
import {
	db,
	documents,
	documentVersions,
	eq,
	showVersion,
	sql,
	user as userTable,
	userFeatures,
} from "@klipstack/db"
import { stopBoss } from "@klipstack/queue"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.hoisted(() => {
	process.env.AI_FAKE = "1"
})

const { env } = await import("~/lib/env.server")
const { usageOf } = await import("~/lib/limits.server")
const { translateArticle, showOriginal } = await import("./translation.server")

const stamp = Date.now()
const users: string[] = []

async function newUser(locale = "en") {
	const id = `test-translate-${stamp}-${users.length}`
	await db.insert(userTable).values({ id, name: "Reader", email: `${id}@example.com`, locale })
	await db.insert(userFeatures).values({ userId: id, feature: "ai" })
	users.push(id)
	return id
}

/** A ready article in Chinese, of `words` words. */
async function article(userId: string, words = 10) {
	// "泡沫" is one word to Intl.Segmenter: words of it, without spaces, as Chinese is written.
	const text = "泡沫".repeat(words)
	const [doc] = await db
		.insert(documents)
		.values({
			userId,
			sourceUrl: `https://example.com/zh/${Math.random()}`,
			urlHash: `${userId}-${Math.random()}`,
			status: "ready",
			title: "两个问题",
			description: "一篇文章",
			language: "zh",
			wordCount: words,
		})
		.returning({ id: documents.id })
	const original = await version(doc!.id, 1, text, {})
	await db.update(documents).set({ currentVersionId: original }).where(eq(documents.id, doc!.id))
	return { id: doc!.id, original }
}

async function version(
	documentId: string,
	n: number,
	text: string,
	extra: Partial<typeof documentVersions.$inferInsert>,
) {
	const [row] = await db
		.insert(documentVersions)
		.values({
			documentId,
			version: n,
			html: `<p>${text}</p>`,
			text,
			textHash: createHash("sha256").update(text).digest("hex"),
			extractor: "test",
			extractorVersion: "0",
			...extra,
		})
		.returning({ id: documentVersions.id })
	return row!.id
}

const read = (id: string) => db.query.documents.findFirst({ where: eq(documents.id, id) })
const jobs = (documentId: string) =>
	db.execute<{ data: Record<string, unknown> }>(
		sql`select data from pgboss.job where name = 'translate' and data->>'documentId' = ${documentId}`,
	)
const refusal = (promise: Promise<unknown>) =>
	promise.then(
		() => null,
		(error: { code?: string }) => error.code,
	)

beforeAll(() => {
	expect(env.LIMIT_TRANSLATIONS_PER_MONTH).toBe(30)
})

afterAll(async () => {
	for (const id of users) {
		await db.execute(
			sql`delete from pgboss.job where data->>'documentId' in (select id::text from documents where user_id = ${id})`,
		)
		await db.delete(userTable).where(eq(userTable.id, id))
	}
	await stopBoss()
})

describe("translateArticle", () => {
	it("takes one credit per started thousand words and queues the translation into the account's language", async () => {
		const userId = await newUser("es")
		const doc = await article(userId, 1500)
		expect(await translateArticle(userId, { id: doc.id })).toEqual({
			status: "pending",
			credits: 2,
		})
		expect((await usageOf(userId)).translations.used).toBe(2)
		expect((await read(doc.id))?.translationStatus).toBe("pending")
		const { rows } = await jobs(doc.id)
		expect(rows.map((r) => r.data)).toEqual([
			expect.objectContaining({ sourceVersionId: doc.original, language: "es", credits: 2 }),
		])
		// Asked twice while it is on its way: refused, and counted once.
		expect(await refusal(translateArticle(userId, { id: doc.id }))).toBe("already_pending")
		expect((await usageOf(userId)).translations.used).toBe(2)
	})

	it("refuses an article over the word cap, and one past the month's credits, counting nothing", async () => {
		const userId = await newUser()
		const long = await article(userId, 20_001)
		expect(await refusal(translateArticle(userId, { id: long.id }))).toBe("invalid_request")
		// 29 credits used: an article of 2 credits doesn't fit in the 30.
		await translateArticle(userId, { id: (await article(userId, 29_000 / 2)).id })
		await translateArticle(userId, { id: (await article(userId, 14_500)).id })
		expect((await usageOf(userId)).translations.used).toBe(30)
		const short = await article(userId, 1500)
		expect(await refusal(translateArticle(userId, { id: short.id }))).toBe("limit_reached")
		expect((await usageOf(userId)).translations.used).toBe(30)
		expect((await read(short.id))?.translationStatus).toBeNull()
		expect((await jobs(short.id)).rows).toHaveLength(0)
	})

	it("is not_found for another account's article, and forbidden with AI turned off", async () => {
		const owner = await newUser()
		const other = await newUser()
		const doc = await article(owner)
		expect(await refusal(translateArticle(other, { id: doc.id }))).toBe("not_found")
		await db
			.update(userTable)
			.set({ prefs: { ai: "off" } })
			.where(eq(userTable.id, owner))
		expect(await refusal(translateArticle(owner, { id: doc.id }))).toBe("forbidden")
	})
})

describe("using the original, and translating again", () => {
	it("puts the original back with its title and language, and shows the translation again for free", async () => {
		const userId = await newUser()
		const doc = await article(userId)
		const translated = await version(doc.id, 2, "Bubble ".repeat(10), {
			translatedFromId: doc.original,
			language: "en",
			title: "Two questions",
			description: null,
			wordCount: 10,
		})
		await db.transaction((tx) => showVersion(tx, doc.id, translated, doc.original))
		expect(await read(doc.id)).toMatchObject({
			title: "Two questions",
			description: null,
			language: "en",
			currentVersionId: translated,
			originalVersionId: doc.original,
		})

		expect(await showOriginal(userId, { id: doc.id })).toEqual({ changed: true })
		expect(await read(doc.id)).toMatchObject({
			title: "两个问题",
			description: "一篇文章",
			language: "zh",
			currentVersionId: doc.original,
			originalVersionId: null,
		})

		expect(await translateArticle(userId, { id: doc.id })).toEqual({
			status: "translated",
			credits: 0,
		})
		expect(await read(doc.id)).toMatchObject({
			title: "Two questions",
			currentVersionId: translated,
		})
		expect((await usageOf(userId)).translations.used).toBe(0)
		// Already shown in the account's language: nothing to do.
		expect(await translateArticle(userId, { id: doc.id })).toEqual({
			status: "translated",
			credits: 0,
		})
	})

	it("keeps a title the reader set, whichever version shows", async () => {
		const userId = await newUser()
		const doc = await article(userId)
		await db
			.update(documents)
			.set({ title: "My title", titleEdited: true })
			.where(eq(documents.id, doc.id))
		const translated = await version(doc.id, 2, "Bubble", {
			translatedFromId: doc.original,
			language: "en",
			title: "Two questions",
		})
		await db.transaction((tx) => showVersion(tx, doc.id, translated, doc.original))
		expect((await read(doc.id))?.title).toBe("My title")
		await showOriginal(userId, { id: doc.id })
		expect((await read(doc.id))?.title).toBe("My title")
	})
})
