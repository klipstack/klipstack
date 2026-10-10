import { randomUUID } from "node:crypto"
import { gzipSync } from "node:zlib"
import {
	db,
	documentOutlinks,
	documentRaw,
	documents,
	documentVersions,
	eq,
	pool,
	sql,
	user,
} from "@klipstack/db"
import { ExtractError, normalizeUrl, urlHash } from "@klipstack/extract"
import { stopBoss } from "@klipstack/queue"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const notify = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock("@klipstack/db", async (original) => ({
	...(await original<typeof import("@klipstack/db")>()),
	notifyDocumentEvent: notify,
}))

/**
 * Extraction waits here, so a test can change the article while the job "runs". `failure`, when
 * set, is what the next extraction throws.
 */
const barrier = vi.hoisted(() => ({
	started: [] as Array<() => void>,
	gate: Promise.resolve(),
	failure: null as Error | null,
}))
vi.mock("@klipstack/extract", async (original) => {
	const real = await original<typeof import("@klipstack/extract")>()
	return {
		...real,
		extractArticle: async (input: Parameters<typeof real.extractArticle>[0]) => {
			barrier.started.shift()?.()
			await barrier.gate
			const failure = barrier.failure
			barrier.failure = null
			if (failure) throw failure
			return real.extractArticle(input)
		},
	}
})

const { handleExtract } = await import("./extract")

const userId = `extract-${randomUUID()}`
const page = (title: string, extra = "") =>
	`<!doctype html><html><head><title>${title}</title></head><body><article><h1>${title}</h1>${extra}${"<p>A paragraph with enough words to read as an article body, repeated for length.</p>".repeat(12)}</article></body></html>`

beforeAll(async () => {
	await db.insert(user).values({ id: userId, name: "Extract", email: `${userId}@example.com` })
})
beforeEach(() => {
	notify.mockClear()
	barrier.started = []
	barrier.gate = Promise.resolve()
	barrier.failure = null
})
afterAll(async () => {
	// Publishing a version admits a real image job. No worker runs here: left behind, the jobs
	// would keep the next one that starts busy, and its tests waiting.
	await db.execute(
		sql`delete from pgboss.job where data->>'versionId' in (select v.id::text from document_versions v join documents d on d.id = v.document_id where d.user_id = ${userId})`,
	)
	await db.delete(user).where(eq(user.id, userId))
	await stopBoss()
	await pool.end()
})

async function saved(title: string) {
	const [doc] = await db
		.insert(documents)
		.values({
			userId,
			sourceUrl: `https://example.com/${randomUUID()}`,
			urlHash: randomUUID(),
			status: "queued",
		})
		.returning()
	await capture(doc!.id, title)
	return doc!
}

const capture = (documentId: string, title: string, at = new Date(), extra = "") =>
	db.insert(documentRaw).values({
		documentId,
		rawHtml: gzipSync(Buffer.from(page(title, extra), "utf8")),
		finalUrl: "https://example.com/article",
		httpStatus: 200,
		contentType: "text/html",
		source: "extension",
		fetchedAt: at,
	})

const job = (documentId: string, retryCount = 0) =>
	({ data: { documentId }, retryCount, retryLimit: 3 }) as Parameters<typeof handleExtract>[0]

/** A capture with nothing to read: a sign-in page. */
const signInPage = (documentId: string, at: Date) =>
	db.insert(documentRaw).values({
		documentId,
		rawHtml: gzipSync(Buffer.from("<html><body><p>Sign in to continue.</p></body></html>")),
		finalUrl: "https://example.com/login",
		httpStatus: 200,
		contentType: "text/html",
		source: "extension",
		fetchedAt: at,
	})

const unavailable = () => new ExtractError("http_error", "HTTP 503", { status: 503 })

/** Holds extraction at the barrier; resolves once `count` jobs have reached it. */
function hold(count = 1) {
	let release!: () => void
	barrier.gate = new Promise<void>((resolve) => {
		release = resolve
	})
	const reached = Array.from(
		{ length: count },
		() => new Promise<void>((resolve) => barrier.started.push(resolve)),
	)
	return { reached: Promise.all(reached), release }
}

const versionsOf = (documentId: string) =>
	db
		.select({ id: documentVersions.id, version: documentVersions.version })
		.from(documentVersions)
		.where(eq(documentVersions.documentId, documentId))
		.orderBy(documentVersions.version)

const docOf = async (id: string) =>
	(await db.select().from(documents).where(eq(documents.id, id)))[0]

describe("handleExtract", () => {
	it("publishes the stored capture as the current version", async () => {
		const doc = await saved("First capture")
		await handleExtract(job(doc.id))
		const versions = await versionsOf(doc.id)
		expect(versions.map((v) => v.version)).toEqual([1])
		expect(await docOf(doc.id)).toMatchObject({
			status: "ready",
			title: "First capture",
			currentVersionId: versions[0]!.id,
		})
		expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "ready" }))
	})

	it("indexes the exact words and their variants for search", async () => {
		const doc = await saved("Búsqueda")
		await handleExtract(job(doc.id))
		const [found] = await db
			.select({
				exact: sql<boolean>`${documents.search} @@ 'repeated'::tsquery`,
				variant: sql<boolean>`${documents.search} @@ 'repeat'::tsquery`,
				unaccented: sql<boolean>`${documents.search} @@ 'busqueda'::tsquery`,
			})
			.from(documents)
			.where(eq(documents.id, doc.id))
		expect(found).toEqual({ exact: true, variant: true, unaccented: true })
	})

	it("keeps the addresses the current version links to, and no others", async () => {
		const outlinksOf = async (documentId: string) =>
			(
				await db
					.select({ urlHash: documentOutlinks.urlHash })
					.from(documentOutlinks)
					.where(eq(documentOutlinks.documentId, documentId))
			)
				.map((r) => r.urlHash)
				.sort()
		const hashes = (...urls: string[]) => urls.map((u) => urlHash(normalizeUrl(u))).sort()
		const links = (...hrefs: string[]) =>
			`<p>Further reading, with enough words around the links: ${hrefs.map((h) => `<a href="${h}">a linked article</a>`).join(" and ")}.</p>`

		const doc = await saved("No links yet")
		await capture(
			doc.id,
			"Links",
			new Date(Date.now() + 1000),
			links("https://other.example/one?utm_source=x", "/two", "#top"),
		)
		await handleExtract(job(doc.id))
		expect(await outlinksOf(doc.id)).toEqual(
			hashes("https://other.example/one", "https://example.com/two"),
		)

		await capture(
			doc.id,
			"Other links",
			new Date(Date.now() + 2000),
			links("https://other.example/three"),
		)
		await handleExtract(job(doc.id))
		expect(await outlinksOf(doc.id)).toEqual(hashes("https://other.example/three"))
	})

	it("publishes nothing when a newer capture arrives while it runs", async () => {
		const doc = await saved("Old capture")
		const { reached, release } = hold()
		const running = handleExtract(job(doc.id))
		await reached
		// What saving the page again does meanwhile; its own job extracts this capture.
		await capture(doc.id, "New capture", new Date(Date.now() + 1000))
		release()
		await running
		expect(await versionsOf(doc.id)).toEqual([])
		expect(await docOf(doc.id)).toMatchObject({ currentVersionId: null, title: null })
		expect(notify).not.toHaveBeenCalled()

		// The job admitted for the new capture then publishes it.
		await handleExtract(job(doc.id))
		expect(await docOf(doc.id)).toMatchObject({ status: "ready", title: "New capture" })
	})

	it("publishes nothing for a document deleted while it runs", async () => {
		const doc = await saved("Deleted meanwhile")
		const { reached, release } = hold()
		const running = handleExtract(job(doc.id))
		await reached
		await db.delete(documents).where(eq(documents.id, doc.id))
		release()
		await running
		expect(await docOf(doc.id)).toBeUndefined()
		expect(notify).not.toHaveBeenCalled()
	})

	it("numbers versions one at a time when two jobs publish the same capture at once", async () => {
		const doc = await saved("Twice")
		const { reached, release } = hold(2)
		const both = Promise.all([handleExtract(job(doc.id)), handleExtract(job(doc.id))])
		await reached
		release()
		await both
		const versions = await versionsOf(doc.id)
		expect(versions.map((v) => v.version)).toEqual([1, 2])
		expect((await docOf(doc.id))?.currentVersionId).toBe(versions[1]!.id)
	})

	it("marks a first capture with nothing to read as failed", async () => {
		const doc = await saved("Unused")
		await signInPage(doc.id, new Date(Date.now() + 1000))
		await handleExtract(job(doc.id))
		expect(await docOf(doc.id)).toMatchObject({ status: "failed", failureReason: "no_content" })
		expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "failed" }))
	})

	it("keeps an article readable when a later capture has nothing to read", async () => {
		const doc = await saved("Readable")
		await handleExtract(job(doc.id))
		const [v1] = await versionsOf(doc.id)
		await signInPage(doc.id, new Date(Date.now() + 1000))
		notify.mockClear()
		await handleExtract(job(doc.id))
		expect(await docOf(doc.id)).toMatchObject({
			status: "ready",
			currentVersionId: v1!.id,
			failureReason: "no_content",
		})
		expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "ready" }))
	})

	it("waits for a retry after a transient failure, readable if it was", async () => {
		const fresh = await saved("Fresh")
		barrier.failure = unavailable()
		await expect(handleExtract(job(fresh.id))).rejects.toThrow("HTTP 503")
		expect(await docOf(fresh.id)).toMatchObject({
			status: "queued",
			failureReason: "http_error:503",
		})

		const readable = await saved("Readable again")
		await handleExtract(job(readable.id))
		barrier.failure = unavailable()
		await expect(handleExtract(job(readable.id))).rejects.toThrow("HTTP 503")
		expect(await docOf(readable.id)).toMatchObject({ status: "ready" })

		barrier.failure = unavailable()
		await handleExtract(job(fresh.id, 3))
		expect(await docOf(fresh.id)).toMatchObject({
			status: "failed",
			failureReason: "http_error:503",
		})
	})

	it("leaves the status to the job of a capture saved while it ran", async () => {
		const doc = await saved("Old capture")
		const { reached, release } = hold()
		barrier.failure = new ExtractError("no_content", "Nothing to read")
		const running = handleExtract(job(doc.id))
		await reached
		// What saving the page again does meanwhile: a new capture and its own job, queued.
		await capture(doc.id, "New capture", new Date(Date.now() + 1000))
		await db.update(documents).set({ status: "queued" }).where(eq(documents.id, doc.id))
		release()
		await running
		expect(await docOf(doc.id)).toMatchObject({ status: "queued", failureReason: null })
		expect(notify).not.toHaveBeenCalled()
	})

	it("drops the thumbnail when the lead picture changes, and keeps it otherwise", async () => {
		const doc = await saved("Pictured")
		await handleExtract(job(doc.id))
		const thumbnail = randomUUID()
		// The page names no lead picture: one already known as none keeps its thumbnail.
		await db
			.update(documents)
			.set({ leadImageAssetId: thumbnail, leadImageUrl: null })
			.where(eq(documents.id, doc.id))
		await capture(doc.id, "Pictured", new Date(Date.now() + 1000))
		await handleExtract(job(doc.id))
		expect((await docOf(doc.id))?.leadImageAssetId).toBe(thumbnail)
		// A lead picture that changed (to none) no longer shows the old thumbnail.
		await db
			.update(documents)
			.set({ leadImageUrl: "https://example.com/old.png" })
			.where(eq(documents.id, doc.id))
		await capture(doc.id, "Pictured", new Date(Date.now() + 2000))
		await handleExtract(job(doc.id))
		expect((await docOf(doc.id))?.leadImageAssetId).toBeNull()
	})
})
