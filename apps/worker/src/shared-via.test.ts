import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { gzipSync } from "node:zlib"
import {
	db,
	documentRaw,
	documents,
	documentTags,
	documentVersions,
	documentVia,
	eq,
	pool,
	sql,
	tags,
	user,
} from "@klipstack/db"
import { ExtractError, normalizeUrl, urlHash, X_RAW_CONTENT_TYPE } from "@klipstack/extract"
import { stopBoss } from "@klipstack/queue"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const notify = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock("@klipstack/db", async (original) => ({
	...(await original<typeof import("@klipstack/db")>()),
	notifyDocumentEvent: notify,
}))

/** The linked page, as the web serves it; `failure`, when set, is what fetching it throws. */
const web = vi.hoisted(() => ({ fetched: [] as string[], failure: null as Error | null }))
vi.mock("@klipstack/extract", async (original) => {
	const real = await original<typeof import("@klipstack/extract")>()
	return {
		...real,
		fetchPage: async (url: string) => {
			web.fetched.push(url)
			if (web.failure) throw web.failure
			return {
				html: essayPage,
				finalUrl: url,
				status: 200,
				contentType: "text/html",
			} as Awaited<ReturnType<typeof real.fetchPage>>
		},
	}
})

const { handleExtract } = await import("./jobs/extract")

const userId = `shared-${randomUUID()}`
const ESSAY = "https://www.theatlantic.com/technology/2026/10/openai-safety-resignation/684000/"
const essayPage = `<!doctype html><html><head><title>The Time for Trial and Error Is Over</title></head><body><article><h1>The Time for Trial and Error Is Over</h1>${"<p>A paragraph with enough words to read as an article body, repeated for length.</p>".repeat(12)}</article></body></html>`

const SHARE = `New in The Atlantic:

@dgrobinson resigned this week. He was among the longest-tenured employees at OpenAI.

You can read his essay here: https://t.co/abcdEFGH12`

/** A real FxTwitter response with its text swapped for `text`, linking `link`. */
function postJson(id: string, text: string, link = ESSAY) {
	const body = JSON.parse(
		readFileSync(
			join(import.meta.dirname, "../../../packages/extract/test/fixtures/x/quote-tegmark.json"),
			"utf8",
		),
	)
	const at = text.indexOf("https://t.co/")
	const facets =
		at < 0 ? [] : [{ type: "url", indices: [at, at + 23], replacement: link, display: "link…" }]
	const status = {
		...body.status,
		id,
		url: `https://x.com/TheAtlantic/status/${id}`,
		text,
		raw_text: { text, display_text_range: [0, text.length], facets },
		quote: null,
	}
	return JSON.stringify({ ...body, status, thread: [status] })
}

/** A post saved and fetched, waiting for its extraction. */
async function savedPost(text = SHARE) {
	const id = String(Date.now()) + String(Math.floor(Math.random() * 1e6))
	const url = normalizeUrl(`https://x.com/TheAtlantic/status/${id}`)
	const [doc] = await db
		.insert(documents)
		.values({ userId, sourceUrl: url, fetchUrl: url, urlHash: urlHash(url), status: "queued" })
		.returning()
	const [raw] = await db
		.insert(documentRaw)
		.values({
			documentId: doc!.id,
			rawHtml: gzipSync(Buffer.from(postJson(id, text), "utf8")),
			finalUrl: url,
			httpStatus: 200,
			contentType: X_RAW_CONTENT_TYPE,
			source: "fetch",
		})
		.returning()
	return { doc: doc!, raw: raw!, url }
}

/** The essay saved from the browser: its page came with it. */
async function savedArticle() {
	const url = normalizeUrl(ESSAY)
	const [doc] = await db
		.insert(documents)
		.values({ userId, sourceUrl: url, fetchUrl: ESSAY, urlHash: urlHash(url), status: "queued" })
		.returning()
	await db.insert(documentRaw).values({
		documentId: doc!.id,
		rawHtml: gzipSync(Buffer.from(essayPage, "utf8")),
		finalUrl: ESSAY,
		httpStatus: 200,
		contentType: "text/html",
		source: "extension",
	})
	return doc!
}

const job = (documentId: string) =>
	({ data: { documentId }, retryCount: 0, retryLimit: 3 }) as Parameters<typeof handleExtract>[0]

const docOf = async (id: string) =>
	(await db.select().from(documents).where(eq(documents.id, id)))[0]
const viaOf = (documentId: string) =>
	db.select().from(documentVia).where(eq(documentVia.documentId, documentId))
const textOf = async (versionId: string | null | undefined) =>
	versionId
		? (await db.select().from(documentVersions).where(eq(documentVersions.id, versionId)))[0]?.text
		: undefined

beforeAll(async () => {
	await db.insert(user).values({ id: userId, name: "Shared", email: `${userId}@example.com` })
})
beforeEach(async () => {
	notify.mockClear()
	web.fetched = []
	web.failure = null
	// Each test saves the essay anew.
	await db.delete(documents).where(eq(documents.userId, userId))
})
afterAll(async () => {
	await db.execute(
		sql`delete from pgboss.job where data->>'versionId' in (select v.id::text from document_versions v join documents d on d.id = v.document_id where d.user_id = ${userId})`,
	)
	await db.delete(user).where(eq(user.id, userId))
	await stopBoss()
	await pool.end()
})

describe("saving a post that shares a link", () => {
	it("saves the linked article in the post's place, and keeps the post with it", async () => {
		const { doc, raw, url } = await savedPost()
		await handleExtract(job(doc.id))

		expect(web.fetched).toEqual([ESSAY])
		const after = await docOf(doc.id)
		expect(after).toMatchObject({
			status: "ready",
			type: "article",
			title: "The Time for Trial and Error Is Over",
			sourceUrl: normalizeUrl(ESSAY),
			urlHash: urlHash(normalizeUrl(ESSAY)),
			fetchUrl: ESSAY,
		})
		expect(await textOf(after?.currentVersionId)).toContain("A paragraph with enough words")
		const [via] = await viaOf(doc.id)
		expect(via).toMatchObject({ url, urlHash: urlHash(url), rawId: raw.id, savedAs: null })
		expect(via?.author).toBe("Max Tegmark")
		expect(via?.html).toContain("You can read his essay here")
		expect(via?.html).not.toContain("<figure")
		expect(notify).toHaveBeenCalledWith(
			expect.objectContaining({ documentId: doc.id, kind: "ready" }),
		)
	})

	it("joins the article when it was saved before, without fetching it, moving the new save's tags", async () => {
		const essayUrl = normalizeUrl(ESSAY)
		const [earlier] = await db
			.insert(documents)
			.values({ userId, sourceUrl: essayUrl, urlHash: urlHash(essayUrl), status: "ready" })
			.returning()
		const { doc, url } = await savedPost()
		const [tag] = await db
			.insert(tags)
			.values({ userId, name: `ai-${randomUUID()}` })
			.returning()
		await db.insert(documentTags).values({ documentId: doc.id, tagId: tag!.id })

		// The site refuses servers; the article came from the browser.
		web.failure = new ExtractError("http_error", "HTTP 403", { status: 403 })
		await handleExtract(job(doc.id))

		expect(web.fetched).toEqual([])
		expect(await docOf(doc.id)).toBeUndefined()
		const [via] = await viaOf(earlier!.id)
		expect(via).toMatchObject({ url, rawId: null, savedAs: doc.id })
		const moved = await db
			.select()
			.from(documentTags)
			.where(eq(documentTags.documentId, earlier!.id))
		expect(moved.map((t) => t.tagId)).toEqual([tag!.id])
		expect(notify).toHaveBeenCalledWith(expect.objectContaining({ documentId: doc.id }))
		expect(notify).toHaveBeenCalledWith(expect.objectContaining({ documentId: earlier!.id }))
	})

	it("saves the post when the linked page can't be read", async () => {
		web.failure = new ExtractError("http_error", "HTTP 403", { status: 403 })
		const { doc, url } = await savedPost()
		await handleExtract(job(doc.id))

		expect(await docOf(doc.id)).toMatchObject({
			status: "ready",
			type: "post",
			sourceUrl: url,
			sharedUrl: ESSAY,
			sharedUrlHash: urlHash(normalizeUrl(ESSAY)),
		})
		expect(await viaOf(doc.id)).toEqual([])
	})

	it("moves a post kept for an unreadable link onto the article once it is saved", async () => {
		web.failure = new ExtractError("http_error", "HTTP 403", { status: 403 })
		const { doc: post, url } = await savedPost()
		await handleExtract(job(post.id))
		const { doc: noted } = await savedPost()
		await handleExtract(job(noted.id))
		await db.update(documents).set({ note: "Mine." }).where(eq(documents.id, noted.id))

		const article = await savedArticle()
		await handleExtract(job(article.id))

		expect(await docOf(post.id)).toBeUndefined()
		const via = await viaOf(article.id)
		expect(via).toHaveLength(1)
		expect(via[0]).toMatchObject({ url, rawId: null, savedAs: post.id })
		expect(via[0]?.html).toContain("You can read his essay here")
		// A post with something of the user's on it stays.
		expect(await docOf(noted.id)).toMatchObject({ type: "post", note: "Mine." })
		expect(notify).toHaveBeenCalledWith(expect.objectContaining({ documentId: post.id }))
	})

	it("saves a post that says more than it links as the post", async () => {
		const { doc, url } = await savedPost(
			`${"A long take of my own, with many thoughts about it. ".repeat(10)}https://t.co/abcdEFGH12`,
		)
		await handleExtract(job(doc.id))

		expect(web.fetched).toEqual([])
		expect(await docOf(doc.id)).toMatchObject({ status: "ready", type: "post", sourceUrl: url })
	})

	it("leaves a readable post as it is when extracted again", async () => {
		web.failure = new ExtractError("http_error", "HTTP 403", { status: 403 })
		const { doc, url } = await savedPost()
		await handleExtract(job(doc.id))
		web.failure = null

		await handleExtract(job(doc.id))
		expect(web.fetched).toHaveLength(1)
		expect(await docOf(doc.id)).toMatchObject({ type: "post", sourceUrl: url })
	})
})
