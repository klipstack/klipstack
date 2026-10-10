import { randomUUID } from "node:crypto"
import { gzipSync } from "node:zlib"
import {
	db,
	desc,
	documentRaw,
	documents,
	documentVia,
	eq,
	sql,
	user as userTable,
} from "@klipstack/db"
import { normalizeUrl, urlHash } from "@klipstack/extract"
import { stopBoss } from "@klipstack/queue"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { findSavedByUrls, joinedArticleId } from "~/services/documents.server"
import { readPostInstead } from "./articles.server"
import { saveArticle } from "./saving.server"

// The worker saves the article a post shares in the post's place. These tests set up what it leaves
// behind, and check what the web app does with it.

const userId = `test-shared-via-${randomUUID()}`
const POST = "https://x.com/someone/status/2099000000000000001"

beforeAll(async () => {
	await db.insert(userTable).values({ id: userId, name: "Sharer", email: `${userId}@example.com` })
})
afterAll(async () => {
	await db.execute(
		sql`delete from pgboss.job where data->>'documentId' in (select id::text from documents where user_id = ${userId})`,
	)
	await db.delete(userTable).where(eq(userTable.id, userId))
	await stopBoss()
})

/** An article saved through a post: the post's capture kept, as the worker leaves it. */
async function sharedArticle() {
	const article = normalizeUrl(`https://example.com/essay-${randomUUID()}`)
	const post = normalizeUrl(POST.replace(/\d+$/, String(Date.now())))
	const [doc] = await db
		.insert(documents)
		.values({ userId, sourceUrl: article, urlHash: urlHash(article), status: "ready" })
		.returning()
	const [raw] = await db
		.insert(documentRaw)
		.values({
			documentId: doc!.id,
			rawHtml: gzipSync(Buffer.from('{"status":{}}')),
			finalUrl: post,
			httpStatus: 200,
			contentType: "application/json",
			source: "fetch",
			fetchedAt: new Date(Date.now() - 60_000),
		})
		.returning()
	await db.insert(documentRaw).values({
		documentId: doc!.id,
		rawHtml: gzipSync(Buffer.from("<p>The essay.</p>")),
		finalUrl: article,
		httpStatus: 200,
		contentType: "text/html",
		source: "fetch",
	})
	const [via] = await db
		.insert(documentVia)
		.values({
			documentId: doc!.id,
			userId,
			url: post,
			urlHash: urlHash(post),
			author: "Someone",
			siteName: "X.com",
			html: "<p>Read this</p>",
			rawId: raw!.id,
		})
		.returning()
	return { doc: doc!, via: via!, post, article }
}

describe("articles saved through a post", () => {
	it("are found again when the post is saved again", async () => {
		const { doc, post } = await sharedArticle()
		const { article, created } = await saveArticle(userId, { url: post, source: "web" })
		expect(created).toBe(false)
		expect(article.id).toBe(doc.id)
	})

	it("count as saved for the post's address, as for their own", async () => {
		const { doc, post, article } = await sharedArticle()
		const saved = await findSavedByUrls(userId, [post, article])
		expect(saved.get(post)).toBe(doc.id)
		expect(saved.get(article)).toBe(doc.id)
	})

	it("turn back into the post, from its capture", async () => {
		const { doc, via, post } = await sharedArticle()
		expect(await readPostInstead(userId, doc.id)).toEqual({ queued: true })

		const [after] = await db.select().from(documents).where(eq(documents.id, doc.id))
		expect(after).toMatchObject({ sourceUrl: post, urlHash: urlHash(post), status: "queued" })
		const [newest] = await db
			.select()
			.from(documentRaw)
			.where(eq(documentRaw.documentId, doc.id))
			.orderBy(desc(documentRaw.fetchedAt))
			.limit(1)
		expect(newest).toMatchObject({ contentType: "application/json", finalUrl: post })
		expect(newest?.id).not.toBe(via.rawId)
		expect(await db.select().from(documentVia).where(eq(documentVia.id, via.id))).toEqual([])
		// Only once: it is the post now.
		expect(await readPostInstead(userId, doc.id)).toEqual({ queued: false })
	})

	it("refuses another user's article", async () => {
		const { doc } = await sharedArticle()
		await expect(readPostInstead(`${userId}-other`, doc.id)).rejects.toMatchObject({
			code: "not_found",
		})
	})

	it("lead a removed save of the post to the article it joined", async () => {
		const { doc, via } = await sharedArticle()
		const removed = randomUUID()
		await db.update(documentVia).set({ savedAs: removed }).where(eq(documentVia.id, via.id))
		expect(await joinedArticleId(userId, removed)).toBe(doc.id)
		expect(await joinedArticleId(`${userId}-other`, removed)).toBeNull()
	})
})
