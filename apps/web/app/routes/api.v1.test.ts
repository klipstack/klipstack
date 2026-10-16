import { readFileSync } from "node:fs"
import { describeRange } from "@klipstack/anchor"
import { BATCH_MAX } from "@klipstack/api-contract"
import {
	db,
	documentRaw,
	documents,
	documentVersions,
	editionItems,
	eq,
	highlights,
	newId,
	user,
} from "@klipstack/db"
import { finishArticle } from "@klipstack/extract"
import { stopBoss } from "@klipstack/queue"
import { errorDetails, type KlipstackApiError, KlipstackInputError } from "@klipstack/sdk"
import { strFromU8, unzipSync } from "fflate"
import { JSDOM } from "jsdom"
import { afterAll, describe, expect, it } from "vitest"
import { env } from "~/lib/env.server"
import { rateLimit, SAVE_LIMIT } from "~/lib/rate-limit.server"
import { getDocument, setNote } from "~/services/documents.server"
import { createEdition } from "~/services/editions.server"
import { createHighlight } from "~/services/highlights.server"
import { apiUsers, captured, extract, FIXTURES, request } from "~/test/api-harness"
import { insertArticle, seedFeeds, storeImage, urlHash } from "../../e2e/seed"

/**
 * The HTTP API at /api/v1, through the SDK as the CLI uses it, answered in this process by the real
 * routes and database. Raw requests only where the SDK hides what is being checked (headers, error
 * bodies). Sign-in through OAuth, and what needs a real HTTP server (bodies refused before they are
 * read), stay in e2e/api.spec.ts.
 */

const origin = new URL(env.APP_URL).origin
const JOEL = FIXTURES.joel
const JOEL_URL = JOEL.url.replace(/\/$/, "")
const QUOTE = "Do you use source control?"
const MISSING = "00000000-0000-4000-8000-000000000000"

const users = apiUsers("api")
const others: string[] = []
afterAll(async () => {
	await users.cleanup()
	for (const id of others) await db.delete(user).where(eq(user.id, id))
	await stopBoss()
})

const errorOf = (promise: Promise<unknown>) =>
	promise.then(
		() => {
			throw new Error("expected the call to fail")
		},
		(e: unknown) => e as KlipstackApiError,
	)

async function otherUser() {
	const id = newId()
	await db.insert(user).values({ id, name: "Other", email: `api-other-${id}@example.com` })
	others.push(id)
	return id
}

function queuedArticle(userId: string) {
	const url = `https://example.com/queued-${newId()}`
	return db
		.insert(documents)
		.values({ userId, sourceUrl: url, urlHash: urlHash(url), status: "queued" })
		.returning({ id: documents.id })
		.then(([row]) => row!.id)
}

describe("the API's door", () => {
	it("an API key reads the account; anything else is challenged", async () => {
		const me = await users.create("API Person")
		expect(await me.client.me()).toEqual({
			id: me.id,
			name: "API Person",
			email: me.email,
			access: "write",
			via: "api_key",
			client: null,
		})

		// The document is public, and describes what the client just called.
		const doc = (await me.client.openapi()) as { openapi: string; paths: Record<string, unknown> }
		expect(doc.openapi).toBe("3.1.0")
		expect(Object.keys(doc.paths)).toContain("/me")
		expect((await request("/api/v1/openapi.json")).status).toBe(200)

		// No token, a bad token, a browser cookie: 401 with a bearer challenge and the error body.
		const none = await request("/api/v1/me")
		expect(none.status).toBe(401)
		expect(none.headers.get("www-authenticate")).toBe('Bearer realm="klipstack"')
		expect(await none.json()).toEqual({
			error: { code: "unauthorized", message: expect.any(String) },
		})
		const bad = await request("/api/v1/me", { token: "klip_nope" })
		expect(bad.status).toBe(401)
		expect(bad.headers.get("www-authenticate")).toBe(
			'Bearer realm="klipstack", error="invalid_token"',
		)
		const cookie = await request("/api/v1/me", { headers: { cookie: "klip.session_token=any" } })
		expect(cookie.status).toBe(401)
		// A well-formed JWT naming a key we do not have: refused like any bad token, on both resources.
		const forged = `${Buffer.from(JSON.stringify({ alg: "EdDSA", kid: "not-ours" })).toString("base64url")}.${Buffer.from("{}").toString("base64url")}.c2ln`
		const forgedApi = await request("/api/v1/me", { token: forged })
		expect(forgedApi.status).toBe(401)
		expect(forgedApi.headers.get("www-authenticate")).toContain('error="invalid_token"')
		const forgedMcp = await request("/mcp", {
			method: "POST",
			token: forged,
			headers: {
				accept: "application/json, text/event-stream",
				"content-type": "application/json",
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
		})
		expect(forgedMcp.status).toBe(401)
		expect(forgedMcp.headers.get("www-authenticate")).toContain("resource_metadata=")

		// Unknown endpoints and methods have the same body shape.
		const missing = await request("/api/v1/nothing", { token: me.key })
		expect(missing.status).toBe(404)
		expect((await missing.json()).error.code).toBe("not_found")
		const wrongMethod = await request("/api/v1/me", { method: "DELETE", token: me.key })
		expect(wrongMethod.status).toBe(405)
		expect(wrongMethod.headers.get("allow")).toBe("GET")
		expect((await wrongMethod.json()).error.code).toBe("method_not_allowed")
	})

	it("a body over the limit gets 413", async () => {
		const me = await users.create("Big Body")
		const urls = Array.from({ length: 50 }, () => `https://example.com/${"x".repeat(30_000)}`)
		const res = await request("/api/v1/articles/lookup", {
			method: "POST",
			token: me.key,
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ urls }),
		})
		expect(res.status).toBe(413)
		expect(await res.json()).toEqual({
			error: { code: "too_large", message: "The body may not exceed 1048576 bytes." },
		})
	})

	it("the SDK measures a capture in bytes and refuses an oversized one before sending", async () => {
		const { client } = await users.create("Huge Page")
		const url = "https://example.com/huge"
		// Under the character count, over the byte limit.
		await expect(
			client.articles.save({ url, html: "€".repeat(4 * 1024 * 1024) }),
		).rejects.toBeInstanceOf(KlipstackInputError)
		// Within the page limit, but JSON escaping doubles it past the body limit.
		const escaped = await client.articles
			.save({ url, html: '"'.repeat(10 * 1024 * 1024) })
			.catch((e: unknown) => e)
		expect(escaped).toBeInstanceOf(KlipstackInputError)
		expect((escaped as Error).message).toContain("bytes")
	})
})

/**
 * A user with the Joel Test (extracted by the worker's job, with a note linking the second article
 * and a highlight with a note) and "Colors" (inserted with two stored images and a remote one).
 */
async function readsLibrary() {
	const me = await users.create("API Reader")
	const joel = await captured(me.id, JOEL)
	const wide = await storeImage(me.id, 2000, 1000, "#c00")
	const small = await storeImage(me.id, 64, 64, "#00c")
	const colors = await insertArticle(
		me.id,
		"Colors",
		`<p>A post about colors.</p><figure><img src="/assets/${wide.id}" data-original-src="https://example.com/red.png" alt="A red band"><figcaption>Figure 1: red</figcaption></figure><p>More <img src="https://example.com/remote.png" alt="Remote"> text.</p><p><img src="/assets/${small.id}" data-original-src="https://example.com/blue.png" alt="A blue square"></p>`,
	)
	await setNote(me.id, joel, `Compare [Colors](/read/${colors}).`)
	// The question appears twice in the article: anchor to the first one.
	const input = { exact: QUOTE, note: "We do, since forever.", color: 1 }
	const first = await createHighlight({ userId: me.id, documentId: joel, input })
	if (first.ok || first.error !== "ambiguous") throw new Error("expected two occurrences")
	const hl = await createHighlight({
		userId: me.id,
		documentId: joel,
		input: { ...input, ...first.candidates[0] },
	})
	expect(hl.ok).toBe(true)
	return { ...me, joel, colors, wide, small }
}

describe("reads", () => {
	it(
		"lists, search, lookup, details, Markdown, highlights and export",
		{ timeout: 30_000 },
		async () => {
			const { key, client, joel, colors, wide, small, id: owner } = await readsLibrary()

			// Lists: views, filters, sorts and pages.
			const inbox = await client.articles.list()
			expect(inbox.items.map((a) => a.id)).toEqual([colors, joel])
			expect(inbox.nextCursor).toBeNull()
			expect(inbox.items[1]).toMatchObject({
				id: joel,
				title: JOEL.title,
				url: JOEL_URL,
				readerUrl: `${origin}/read/${joel}`,
				location: "inbox",
				status: "ready",
				opened: false,
				trashedAt: null,
				readingMinutes: expect.any(Number),
			})
			const first = await client.articles.list({ limit: 1, sort: "oldest" })
			expect(first.items.map((a) => a.id)).toEqual([joel])
			expect(first.nextCursor).toEqual(expect.any(String))
			const second = await client.articles.list({
				limit: 1,
				sort: "oldest",
				cursor: first.nextCursor,
			})
			expect(second.items.map((a) => a.id)).toEqual([colors])
			const all = []
			for await (const a of client.articles.all({ limit: 1 })) all.push(a.id)
			expect(all).toEqual([colors, joel])
			expect((await client.articles.list({ filter: "unread" })).items).toHaveLength(2)
			expect((await client.articles.list({ view: "archive" })).items).toEqual([])
			expect((await client.articles.list({ view: "trash" })).items).toEqual([])
			// The SDK refuses a filter that does not belong to the view before sending; the server too.
			await expect(
				client.articles.list({ view: "trash", filter: "unread" }),
			).rejects.toBeInstanceOf(KlipstackInputError)
			const wrongFilter = await request("/api/v1/articles?view=archive&filter=unread", {
				token: key,
			})
			expect(wrongFilter.status).toBe(400)
			expect(await wrongFilter.json()).toMatchObject({
				error: {
					code: "invalid_request",
					details: { where: "query", issues: [expect.objectContaining({ path: ["filter"] })] },
				},
			})
			expect((await request("/api/v1/articles?cursor=nope", { token: key })).status).toBe(400)

			// Search and lookup.
			expect((await client.articles.search("source control")).items[0]?.id).toBe(joel)
			expect((await client.articles.search("zzzznotthere")).items).toEqual([])
			// Operators filter and may stand alone; pages go by offset; what is not understood comes back.
			const firstPage = await client.articles.search("in:library sort:oldest", { limit: 1 })
			expect(firstPage).toMatchObject({ items: [expect.anything()], nextOffset: 1, ignored: [] })
			const lastPage = await client.articles.search("in:library sort:oldest", {
				limit: 1,
				offset: 1,
			})
			expect(lastPage.items).toHaveLength(1)
			expect(lastPage.items[0]?.id).not.toBe(firstPage.items[0]?.id)
			expect(lastPage.nextOffset).toBeNull()
			expect((await client.articles.search("source control in:trash")).items).toEqual([])
			expect(await client.articles.search("source control is:unred")).toMatchObject({
				items: [{ id: joel }],
				ignored: ["is:unred"],
			})
			const lookup = await client.articles.lookup([
				JOEL.url,
				JOEL_URL,
				"https://example.com/not-saved",
				"not a url",
			])
			expect(lookup.items).toEqual([
				{ url: JOEL.url, id: joel },
				{ url: JOEL_URL, id: joel },
				{ url: "https://example.com/not-saved", id: null },
				{ url: "not a url", id: null },
			])

			// Details: note, highlights, links both ways, images.
			const details = await client.articles.get(joel)
			expect(details).toMatchObject({
				id: joel,
				note: `Compare [Colors](/read/${colors}).`,
				noteUpdatedAt: expect.any(String),
				highlights: [
					{
						id: expect.any(String),
						quote: QUOTE,
						note: "We do, since forever.",
						color: "green",
						article: { id: joel, title: JOEL.title, url: JOEL_URL },
					},
				],
				noteLinks: {
					to: [
						{
							id: colors,
							title: "Colors",
							status: "ok",
							url: expect.stringMatching(/^https:\/\/example\.com\/colors-/),
							readerUrl: `${origin}/read/${colors}`,
							highlight: null,
						},
					],
					from: [],
				},
				// A note link is not a link in the content.
				contentLinks: { to: [], from: [] },
				notStoredImages: expect.any(Number),
				// No worker fetches this page's images here: they are still pending.
				imagesPending: expect.any(Boolean),
			})
			expect(details).not.toHaveProperty("markdown")
			const colorDetails = await client.articles.get(colors)
			expect(colorDetails.noteLinks.from).toEqual([
				{
					id: joel,
					title: JOEL.title,
					url: JOEL_URL,
					readerUrl: `${origin}/read/${joel}`,
					highlight: null,
				},
			])
			expect(colorDetails.images).toEqual([
				{
					number: 1,
					id: wide.id,
					alt: "A red band",
					caption: "Figure 1: red",
					width: 2000,
					height: 1000,
					bytes: wide.data.length,
					url: `${origin}/assets/${wide.id}`,
					downloadUrl: `${origin}/api/v1/assets/${wide.id}`,
				},
				expect.objectContaining({ number: 2, id: small.id, alt: "A blue square", width: 64 }),
			])
			expect(colorDetails.notStoredImages).toBe(1)
			expect(colorDetails.imagesPending).toBe(false)
			expect(await errorOf(client.articles.get(MISSING))).toMatchObject({
				status: 404,
				code: "not_found",
			})

			// Markdown: front matter, text, note, highlights; images stored or original.
			const markdown = await client.articles.markdown(joel)
			expect(markdown).toMatch(/^---\ntitle: "The Joel Test/)
			expect(markdown).toContain(`# ${JOEL.title}`)
			expect(markdown).toContain(`## Note\n\nCompare [Colors](${origin}/read/${colors}).`)
			expect(markdown).toContain(`## Highlights\n\n> ${QUOTE}\n\nWe do, since forever.`)
			const stored = await client.articles.markdown(colors)
			expect(stored).toContain(`![A red band](${origin}/assets/${wide.id})`)
			expect(stored).toContain(`![A blue square](${origin}/assets/${small.id})`)
			expect(stored).toContain("![Remote](https://example.com/remote.png)")
			const original = await client.articles.markdown(colors, { images: "original" })
			expect(original).toContain("![A red band](https://example.com/red.png)")
			expect(original).toContain("![A blue square](https://example.com/blue.png)")
			expect(original).not.toContain("/assets/")
			const rawMarkdown = await request(`/api/v1/articles/${colors}/markdown`, { token: key })
			expect(rawMarkdown.headers.get("content-type")).toBe("text/markdown; charset=utf-8")
			const queued = await queuedArticle(owner)
			expect(await errorOf(client.articles.markdown(queued))).toMatchObject({
				status: 422,
				code: "not_ready",
			})

			// Assets: the stored file for its owner only.
			const image = await client.assets.download(wide.id)
			expect(image.headers.get("content-type")).toBe("image/webp")
			expect(image.headers.get("content-length")).toBe(String(wide.data.length))
			const etag = image.headers.get("etag") ?? ""
			expect(Buffer.from(await image.arrayBuffer()).equals(wide.data)).toBe(true)
			const cached = await request(`/api/v1/assets/${wide.id}`, {
				token: key,
				headers: { "if-none-match": etag },
			})
			expect(cached.status).toBe(304)
			const otherId = await otherUser()
			const theirs = await storeImage(otherId, 32, 32, "#0c0")
			expect(await errorOf(client.assets.download(theirs.id))).toMatchObject({
				status: 404,
				code: "not_found",
			})
			const theirArticle = await insertArticle(otherId, "Theirs", "<p>Not yours.</p>")
			expect(await errorOf(client.articles.get(theirArticle))).toMatchObject({ status: 404 })
			expect(await errorOf(client.articles.markdown(theirArticle))).toMatchObject({ status: 404 })

			// Highlights: filters, search, one article's, pages.
			const hls = await client.highlights.list()
			expect(hls.items).toEqual([details.highlights[0]])
			expect((await client.highlights.list({ filter: "notes" })).items).toHaveLength(1)
			expect((await client.highlights.list({ filter: "green" })).items).toHaveLength(1)
			expect((await client.highlights.list({ filter: "pink" })).items).toEqual([])
			expect((await client.highlights.list({ q: "forever" })).items).toHaveLength(1)
			expect((await client.highlights.list({ article: colors })).items).toEqual([])
			expect(await errorOf(client.highlights.list({ article: MISSING }))).toMatchObject({
				status: 404,
			})
			expect((await client.highlights.list({ limit: 1 })).nextCursor).toBeNull()
			const impossible = Buffer.from(
				JSON.stringify({ createdAt: "2026-13-01T00:00:00Z", id: MISSING }),
			).toString("base64url")
			expect(
				(await request(`/api/v1/highlights?cursor=${impossible}`, { token: key })).status,
			).toBe(400)

			// Export, as Settings makes it.
			const zip = await client.export()
			expect(zip.headers.get("content-type")).toBe("application/zip")
			expect(zip.headers.get("content-disposition")).toMatch(
				/^attachment; filename="klipstack-.*\.zip"$/,
			)
			const files = unzipSync(new Uint8Array(await zip.arrayBuffer()))
			expect(Object.keys(files)).toEqual(
				expect.arrayContaining(["highlights.md", "klipstack.json"]),
			)
			const json = await client.export("json")
			const bundle = JSON.parse(strFromU8(new Uint8Array(await json.arrayBuffer())))
			expect(bundle.documents.map((d: { id: string }) => d.id)).toEqual([joel, colors, queued])
		},
	)

	it("the feed page and followed feeds", async () => {
		const { email, client } = await users.create("API Feeds")
		await seedFeeds(email)

		const listed = await client.feed.get()
		expect(Date.parse(listed.listedAt)).toBeLessThanOrEqual(Date.now())
		expect(listed.feeds).toHaveLength(1)
		const busy = listed.feeds[0]!
		expect(busy).toMatchObject({
			title: "Busy blog",
			newCount: 3,
			notUpdating: false,
			moreItems: 0,
		})
		expect(busy.items.map((i) => i.title)).toEqual(["Busy post 3", "Busy post 2", "Busy post 1"])
		expect(busy.items[0]).toMatchObject({ author: "Ann", new: true, savedArticleId: null })
		expect(listed.quietFeeds).toEqual([
			expect.objectContaining({ title: "Quiet blog", notUpdating: true }),
		])
		const short = await client.feed.get({ perFeed: 2, feed: busy.id })
		expect(short.feeds[0]?.items).toHaveLength(2)
		expect(short.feeds[0]?.moreItems).toBe(1)
		expect(short.quietFeeds).toEqual([])
		expect((await client.feed.get({ newOnly: true })).feeds).toHaveLength(1)

		expect((await client.feeds.list()).items).toEqual([
			{
				id: busy.id,
				title: "Busy blog",
				siteUrl: expect.any(String),
				newCount: 3,
				notUpdating: false,
			},
			{
				id: listed.quietFeeds[0]!.id,
				title: "Quiet blog",
				siteUrl: expect.any(String),
				newCount: 0,
				notUpdating: true,
			},
		])
	})

	it("link previews refuse what they can't fetch", async () => {
		const { client } = await users.create("API Previews")
		// A private address: refused by the fetcher, so no preview (and nothing saved).
		expect(await client.links.preview("http://127.0.0.1:5433/secret")).toEqual({ preview: null })
		for (const url of ["ftp://example.com/", "https://user:pass@example.com/"])
			expect(await errorOf(client.links.preview(url)), url).toMatchObject({
				status: 422,
				code: "invalid_url",
			})
		const anonymous = await request(
			`/api/v1/links/preview?${new URLSearchParams({ url: "https://example.com/" })}`,
		)
		expect(anonymous.status).toBe(401)
	})

	it("links in an article's content connect it to the saved articles it links to", async () => {
		const { id: owner, client } = await users.create("API Content Links")
		const paragraph =
			"This paragraph exists so the extractor keeps the article. It says nothing of interest, but it is long enough to count as content, and it repeats that idea a few more times for good measure. "
		const html = `<!DOCTYPE html><html><head><title>Linky</title></head><body><article><h1>Linky</h1>
			<p>${paragraph}</p><p>Read <a href="${JOEL.url}?utm_source=linky">the Joel Test</a> first.</p>
			<p>${paragraph}</p><p>${paragraph}</p><p>${paragraph}</p></article></body></html>`
		const linky = await captured(owner, { url: "https://example.com/linky", html })
		// The article it links to is not saved yet: nothing to connect.
		expect((await client.articles.get(linky)).contentLinks).toEqual({ to: [], from: [] })

		const joel = await captured(owner, JOEL)
		const linkyDetails = await client.articles.get(linky)
		expect(linkyDetails.contentLinks).toEqual({
			to: [{ id: joel, title: JOEL.title, url: JOEL_URL, readerUrl: `${origin}/read/${joel}` }],
			from: [],
		})
		// The author's link is not the user's: note links stay empty.
		expect(linkyDetails.noteLinks).toEqual({ to: [], from: [] })
		const joelDetails = await client.articles.get(joel)
		expect(joelDetails.contentLinks.from).toEqual([
			{
				id: linky,
				title: "Linky",
				url: "https://example.com/linky",
				readerUrl: `${origin}/read/${linky}`,
			},
		])
		expect(joelDetails.noteLinks).toEqual({ to: [], from: [] })

		await client.articles.trash([joel])
		expect((await client.articles.get(linky)).contentLinks).toEqual({ to: [], from: [] })
	})
})

const json = (body: unknown) => ({
	headers: { "content-type": "application/json" },
	body: JSON.stringify(body),
})

describe("writes", () => {
	it("doesn't keep articles: reviewing old saves is the web's only, for now", async () => {
		const { id, key } = await users.create("API Keeper")
		const article = await insertArticle(id, "Kept", "<p>Kept</p>")
		const res = await request("/api/v1/articles", {
			method: "PATCH",
			token: key,
			...json({ ids: [article], starred: true, kept: true }),
		})
		expect(res.status).toBe(200)
		const [row] = await db
			.select({ starredAt: documents.starredAt, keptAt: documents.keptAt })
			.from(documents)
			.where(eq(documents.id, article))
		expect(row).toEqual({ starredAt: expect.any(Date), keptAt: null })
	})

	it(
		"save, triage, tags, saved searches, rename, trash and restore",
		{ timeout: 30_000 },
		async () => {
			const { key, client } = await users.create("API Writer")
			const html = readFileSync(JOEL.file, "utf8")

			// Saving: 202 when new, 200 when the URL is already there; the capture is stored and extracted.
			const created = await request("/api/v1/articles", {
				method: "POST",
				token: key,
				...json({ url: JOEL.url, html, source: "extension" }),
			})
			expect(created.status).toBe(202)
			const first = (await created.json()) as { article: { id: string }; created: boolean }
			expect(first).toMatchObject({ created: true, article: { status: "queued", url: JOEL_URL } })
			const joel = first.article.id
			await extract(joel)
			expect((await client.articles.get(joel)).title).toBe(JOEL.title)
			const captures = () =>
				db
					.select({ source: documentRaw.source })
					.from(documentRaw)
					.where(eq(documentRaw.documentId, joel))
			expect(await captures()).toEqual([{ source: "extension" }])
			const again = await request("/api/v1/articles", {
				method: "POST",
				token: key,
				...json({ url: JOEL.url }),
			})
			expect(again.status).toBe(200)
			expect(await again.json()).toMatchObject({
				created: false,
				article: { id: joel, status: "ready" },
			})
			expect(await captures()).toHaveLength(1)
			// A new capture of the same URL is extracted again.
			const recapture = await client.articles.save({ url: JOEL.url, html })
			expect(recapture).toMatchObject({ created: false, article: { id: joel, status: "queued" } })
			expect((await captures()).map((c) => c.source).sort()).toEqual(["api", "extension"])
			await extract(joel)
			for (const [url, code] of [
				["not a url", "invalid_url"],
				["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "unsupported_youtube"],
			] as const)
				expect(await errorOf(client.articles.save({ url }))).toMatchObject({ status: 422, code })
			const makers = (
				await client.articles.save({
					url: FIXTURES.makers.url,
					html: readFileSync(FIXTURES.makers.file, "utf8"),
				})
			).article.id

			// Triage in batches; ids not in the library are reported.
			const starred = await client.articles.update([joel, makers, joel, MISSING], { starred: true })
			expect(starred.items.map((a) => [a.id, a.starred])).toEqual([
				[joel, true],
				[makers, true],
			])
			expect(starred.notFound).toEqual([MISSING])
			// Marked for the next edition, and found by it.
			const marked = await client.articles.update([makers], { shortlisted: true })
			expect(marked.items[0]).toMatchObject({ id: makers, shortlisted: true, starred: true })
			expect((await client.articles.get(joel)).shortlisted).toBe(false)
			const finished = await client.articles.update([joel], { finished: true })
			expect(finished.items[0]).toMatchObject({
				location: "archive",
				finished: true,
				finishedAt: expect.any(String),
			})
			expect((await client.articles.list({ view: "archive" })).items.map((a) => a.id)).toEqual([
				joel,
			])
			// Its undo puts it back as it was, once; a change that changed nothing has none.
			expect(finished.undo).toHaveLength(1)
			const undone = await client.articles.undo(finished.undo![0]!)
			expect(undone.items[0]).toMatchObject({ id: joel, location: "inbox", finished: false })
			expect((await client.articles.update([makers], { shortlisted: true })).undo).toEqual([])
			expect(await errorOf(client.articles.undo("not.a-token"))).toMatchObject({
				status: 400,
				code: "invalid_request",
			})
			await client.articles.update([joel], { finished: true })
			const back = await client.articles.update([joel], { location: "inbox" })
			expect(back.items[0]).toMatchObject({ location: "inbox", finished: false })
			await client.articles.update([joel], { finished: false })
			expect((await client.articles.list({ filter: "unread" })).items.map((a) => a.id)).toContain(
				joel,
			)
			// Tags: made by using them, matched whatever the case, listed with their counts, and searched.
			const tagged = await client.articles.update([joel, makers], {
				addTags: ["Later", "reference"],
			})
			expect(tagged.items.map((a) => a.tags)).toEqual([
				["Later", "reference"],
				["Later", "reference"],
			])
			const untagged = await client.articles.update([makers], {
				removeTags: ["LATER", "never there"],
			})
			expect(untagged.items[0]?.tags).toEqual(["reference"])
			const listed = (await client.tags.list()).items
			expect(listed).toEqual([
				{ id: expect.any(String), name: "Later", articles: 1 },
				{ id: expect.any(String), name: "reference", articles: 2 },
			])
			const [later, reference] = listed as [(typeof listed)[number], (typeof listed)[number]]
			expect((await client.articles.search("tag:later")).items.map((a) => a.id)).toEqual([joel])
			expect((await client.articles.get(joel)).tags).toEqual(["Later", "reference"])
			// More tags than an article may have: refused whole, and the star that came along too.
			const tooMany = Array.from({ length: 19 }, (_, i) => `bulk ${i}`)
			expect(
				await errorOf(client.articles.update([joel, makers], { addTags: tooMany, starred: false })),
			).toMatchObject({ status: 422, code: "too_many_article_tags" })
			expect((await client.articles.get(makers)).tags).toEqual(["reference"])
			expect((await client.articles.get(joel)).starred).toBe(true)
			// The tags themselves: made ahead of their articles, renamed, merged and deleted.
			const made = await client.tags.create("  To  Read ")
			expect(made).toMatchObject({ created: true, tag: { name: "To Read", articles: 0 } })
			expect(await client.tags.create("to read")).toMatchObject({
				created: false,
				tag: { id: made.tag.id, name: "To Read" },
			})
			expect(await client.tags.rename(made.tag.id, "Queue")).toEqual({
				tag: { id: made.tag.id, name: "Queue", articles: 0 },
				merged: false,
			})
			// Saved searches: named queries. A name is taken whatever its case; a tag rename follows into
			// the queries, here a merge.
			const pinned = await client.savedSearches.create("  Read  later ", " is:unread tag:LATER ")
			expect(pinned).toEqual({
				savedSearch: { id: expect.any(String), name: "Read later", query: "is:unread tag:LATER" },
			})
			expect(await errorOf(client.savedSearches.create("read LATER", "zebra"))).toMatchObject({
				status: 409,
				code: "name_taken",
			})
			const other = await client.savedSearches.create("Zebras", "zebra")
			expect(
				await errorOf(client.savedSearches.rename(other.savedSearch.id, "Read later")),
			).toMatchObject({ status: 409, code: "name_taken" })
			expect(await client.savedSearches.rename(other.savedSearch.id, "Animals")).toEqual({
				savedSearch: { id: other.savedSearch.id, name: "Animals", query: "zebra" },
			})
			for (const data of [
				{ name: "No query" },
				{ name: "", query: "zebra" },
				{ name: "Blank", query: " " },
			]) {
				const res = await request("/api/v1/saved-searches", {
					method: "POST",
					token: key,
					...json(data),
				})
				expect(res.status, JSON.stringify(data)).toBe(400)
			}
			// A name another tag has merges the two: "Later" goes, and "reference" keeps both articles.
			expect(await client.tags.rename(later.id, "REFERENCE")).toEqual({
				tag: { id: reference.id, name: "reference", articles: 2 },
				merged: true,
			})
			expect((await client.articles.get(joel)).tags).toEqual(["reference"])
			expect(await errorOf(client.tags.rename(later.id, "gone"))).toMatchObject({ status: 404 })
			expect((await client.savedSearches.list()).items).toEqual([
				{ id: other.savedSearch.id, name: "Animals", query: "zebra" },
				{ id: pinned.savedSearch.id, name: "Read later", query: "is:unread tag:reference" },
			])
			await client.savedSearches.delete(other.savedSearch.id)
			expect(await errorOf(client.savedSearches.delete(other.savedSearch.id))).toMatchObject({
				status: 404,
			})
			await client.tags.delete(made.tag.id)
			// A tag a saved search names is refused, with that search; forced, the tag goes and the search
			// stays as it was, finding nothing.
			const refused = await errorOf(client.tags.delete(reference.id))
			expect(refused).toMatchObject({ status: 409, code: "tag_in_saved_searches" })
			const readLater = {
				id: pinned.savedSearch.id,
				name: "Read later",
				query: "is:unread tag:reference",
			}
			expect(errorDetails(refused, "tag_in_saved_searches")).toEqual({ savedSearches: [readLater] })
			expect((await client.tags.list()).items.map((t) => t.name)).toEqual(["reference"])
			await client.tags.delete(reference.id, { force: true })
			expect(await errorOf(client.tags.delete(reference.id))).toMatchObject({ status: 404 })
			expect((await client.tags.list()).items).toEqual([])
			expect((await client.savedSearches.list()).items).toEqual([readLater])
			// Deleting a tag leaves its articles, without it.
			expect((await client.articles.get(makers)).tags).toEqual([])
			for (const data of [{ name: "a,b" }, { name: "" }, {}]) {
				const res = await request("/api/v1/tags", { method: "POST", token: key, ...json(data) })
				expect(res.status, JSON.stringify(data)).toBe(400)
			}
			// Contradictions and empty changes are refused, by the SDK and by the server.
			await expect(
				client.articles.update([joel], { finished: true, location: "inbox" }),
			).rejects.toBeInstanceOf(KlipstackInputError)
			for (const data of [
				{ ids: [joel], finished: true, location: "inbox" },
				{ ids: [joel] },
				{ ids: [joel], addTags: ["a,b"] },
				{ ids: [joel], removeTags: [] },
				{ ids: [] },
				{ ids: Array.from({ length: BATCH_MAX + 1 }, () => crypto.randomUUID()), starred: true },
			]) {
				const res = await request("/api/v1/articles", {
					method: "PATCH",
					token: key,
					...json(data),
				})
				expect(res.status, JSON.stringify(data)).toBe(400)
				expect((await res.json()).error.code).toBe("invalid_request")
			}

			// Rename.
			expect((await client.articles.rename(joel, "  Joel's test  ")).article.title).toBe(
				"Joel's test",
			)
			await expect(client.articles.rename(joel, "x".repeat(301))).rejects.toBeInstanceOf(
				KlipstackInputError,
			)
			expect(await errorOf(client.articles.rename(MISSING, "Nope"))).toMatchObject({ status: 404 })

			// Trash and restore report what was in the wrong state.
			expect(await client.articles.trash([joel, MISSING])).toEqual({
				trashed: [joel],
				notFound: [MISSING],
			})
			expect(await client.articles.trash([joel])).toEqual({ trashed: [], notFound: [joel] })
			await expect(client.articles.trash([])).rejects.toBeInstanceOf(KlipstackInputError)
			expect((await client.articles.list({ view: "trash" })).items).toEqual([
				expect.objectContaining({ id: joel, trashedAt: expect.any(String) }),
			])
			expect(await errorOf(client.articles.get(joel))).toMatchObject({ status: 404 })
			expect(await errorOf(client.articles.rename(joel, "Gone"))).toMatchObject({ status: 404 })
			expect((await client.articles.lookup([JOEL.url])).items[0]?.id).toBeNull()
			expect(await client.articles.restore([joel, makers])).toEqual({
				restored: [joel],
				notFound: [makers],
				alreadySaved: [],
			})
			expect((await client.articles.get(joel)).title).toBe("Joel's test")

			// A trashed article whose URL was saved again cannot come back; the new one is named.
			await client.articles.trash([joel])
			const resaved = (await client.articles.save({ url: JOEL.url })).article.id
			expect(resaved).not.toBe(joel)
			expect(await client.articles.restore([joel])).toEqual({
				restored: [],
				notFound: [],
				alreadySaved: [{ id: joel, articleId: resaved }],
			})

			// Another user's articles are not found.
			const theirs = await insertArticle(await otherUser(), "Theirs", "<p>Not yours.</p>")
			expect(await client.articles.trash([theirs])).toEqual({ trashed: [], notFound: [theirs] })
			expect((await client.articles.update([theirs], { starred: true })).notFound).toEqual([theirs])
		},
	)

	it("retries a failed save, and deletes articles in the trash for good", async () => {
		const { id: owner, client } = await users.create("API Retry")
		const failedUrl = `https://example.com/failed-${newId()}`
		const [failedRow] = await db
			.insert(documents)
			.values({
				userId: owner,
				sourceUrl: failedUrl,
				urlHash: urlHash(failedUrl),
				status: "failed",
				failureReason: "fetch_failed",
			})
			.returning({ id: documents.id })
		const failed = failedRow!.id
		const ready = await insertArticle(owner, "Ready", "<p>Read me.</p>")

		// Retry queues a failed save again, once; a save that hadn't failed stays as it is.
		expect(await client.articles.retry(failed)).toEqual({ queued: true })
		expect(await client.articles.get(failed)).toMatchObject({ status: "queued" })
		expect(await client.articles.retry(failed)).toEqual({ queued: false })
		expect(await client.articles.retry(ready)).toEqual({ queued: false })
		expect(await client.articles.get(ready)).toMatchObject({ status: "ready" })

		// Missing, another user's or in the trash: not found.
		const theirs = await insertArticle(await otherUser(), "Theirs", "<p>Not yours.</p>")
		await client.articles.trash([ready])
		for (const id of [MISSING, theirs, ready])
			expect(await errorOf(client.articles.retry(id))).toMatchObject({
				status: 404,
				code: "not_found",
			})

		// Purge takes only what is in the trash, and only the owner's.
		expect(await client.articles.purge([ready, failed, theirs, MISSING])).toEqual({
			purged: [ready],
			notFound: [failed, theirs, MISSING],
		})
		expect((await client.articles.list({ view: "trash" })).items).toEqual([])
		expect(await client.articles.restore([ready])).toMatchObject({
			restored: [],
			notFound: [ready],
		})
		expect(await client.articles.get(failed)).toMatchObject({ id: failed })
		expect(await db.select().from(documents).where(eq(documents.id, theirs))).toHaveLength(1)
		await expect(client.articles.purge([])).rejects.toBeInstanceOf(KlipstackInputError)

		// A retry fetches the page again: it counts as a save, and past the save limit it waits.
		const againUrl = `https://example.com/failed-${newId()}`
		const [againRow] = await db
			.insert(documents)
			.values({ userId: owner, sourceUrl: againUrl, urlHash: urlHash(againUrl), status: "failed" })
			.returning({ id: documents.id })
		for (let i = 0; i < SAVE_LIMIT.limit; i++)
			rateLimit(`save:${owner}`, SAVE_LIMIT.limit, SAVE_LIMIT.windowMs)
		expect(await errorOf(client.articles.retry(againRow!.id))).toMatchObject({
			status: 429,
			code: "rate_limited",
		})
		expect(await client.articles.get(againRow!.id)).toMatchObject({ status: "failed" })
	})

	it("the mark says what it did to the draft in progress, and undo puts it back", async () => {
		const { id: owner, client } = await users.create("API Draft")
		const article = await insertArticle(owner, "Drafted", "<p>Worth sharing.</p>")
		// No draft yet: only the mark changes.
		const alone = await client.articles.update([article], { shortlisted: true })
		expect(alone).toMatchObject({ addedToDraft: [], removedFromDraft: [] })
		await client.articles.update([article], { shortlisted: false })

		const draft = await createEdition(owner, { locale: "en", timeZone: "Europe/Madrid" })
		const inDraft = () =>
			db
				.select({ documentId: editionItems.documentId })
				.from(editionItems)
				.where(eq(editionItems.editionId, draft.id))
		const marked = await client.articles.update([article, MISSING], { shortlisted: true })
		expect(marked).toMatchObject({ addedToDraft: [article], removedFromDraft: [] })
		expect(await inDraft()).toEqual([{ documentId: article }])

		const unmarked = await client.articles.update([article], { shortlisted: false })
		expect(unmarked).toMatchObject({ addedToDraft: [], removedFromDraft: [article] })
		expect(await inDraft()).toEqual([])
		const undone = await client.articles.undo(unmarked.undo![0]!)
		expect(undone.items[0]).toMatchObject({ id: article, shortlisted: true })
		expect(await inDraft()).toEqual([{ documentId: article }])
		// Starring changes no draft.
		expect(await client.articles.update([article], { starred: true })).toMatchObject({
			addedToDraft: [],
			removedFromDraft: [],
		})
	})

	it("the note for the next edition, apart from the private note", async () => {
		const { id: owner, key, client } = await users.create("API Edition Note")
		const article = await insertArticle(owner, "Shared", "<p>Worth reading.</p>")
		expect((await client.articles.get(article)).editionNote).toBeNull()
		expect(await client.articles.setEditionNote(article, "  Read the second half.  ")).toEqual({
			editionNote: "Read the second half.",
		})
		expect(await client.articles.get(article)).toMatchObject({
			editionNote: "Read the second half.",
			note: null,
		})
		expect(await client.articles.setEditionNote(article, "")).toEqual({ editionNote: null })
		expect(await errorOf(client.articles.setEditionNote(MISSING, "x"))).toMatchObject({
			status: 404,
		})
		const long = await request(`/api/v1/articles/${article}/edition-note`, {
			method: "PUT",
			token: key,
			...json({ note: "x".repeat(100_001) }),
		})
		expect(long.status).toBe(400)
	})

	it("notes with conflict checks, and highlights by quote", { timeout: 30_000 }, async () => {
		const { id: owner, key, client } = await users.create("API Notes")
		const joel = await captured(owner, JOEL)
		const colors = await insertArticle(owner, "Colors", "<p>Red and blue.</p>")

		// Notes: null means "never saved"; a time must match; full reader URLs become note links.
		expect((await client.articles.get(joel)).noteUpdatedAt).toBeNull()
		const saved = await client.articles.setNote(joel, `See [Colors](${origin}/read/${colors})`, {
			expectedUpdatedAt: null,
		})
		expect(saved).toEqual({
			note: `See [Colors](/read/${colors})`,
			noteUpdatedAt: expect.any(String),
		})
		const conflict = await errorOf(
			client.articles.setNote(joel, "Overwrite", { expectedUpdatedAt: null }),
		)
		expect(conflict).toMatchObject({
			status: 409,
			code: "note_changed",
			details: { note: saved.note, noteUpdatedAt: saved.noteUpdatedAt },
		})
		const stale = new Date(Date.parse(saved.noteUpdatedAt!) - 1000).toISOString()
		expect(
			await errorOf(client.articles.setNote(joel, "Overwrite", { expectedUpdatedAt: stale })),
		).toMatchObject({ status: 409, code: "note_changed" })
		expect((await client.articles.get(joel)).note).toBe(saved.note)
		// Times Postgres cannot store are invalid input, not server errors.
		for (const expectedUpdatedAt of ["0000-01-01T00:00:00Z", "2026-01-01T00:00:00+16:00"]) {
			const res = await request(`/api/v1/articles/${joel}/note`, {
				method: "PUT",
				token: key,
				...json({ note: "Private words", expectedUpdatedAt }),
			})
			expect(res.status, expectedUpdatedAt).toBe(400)
			expect(JSON.stringify(await res.json())).not.toContain("Private words")
		}
		expect((await client.articles.get(colors)).noteLinks.from.map((l) => l.id)).toEqual([joel])
		const appended = await client.articles.appendNote(joel, "  And more.  ")
		expect(appended.note).toBe(`See [Colors](/read/${colors})\n\nAnd more.`)
		const replaced = await client.articles.setNote(joel, "Only this.", {
			expectedUpdatedAt: appended.noteUpdatedAt,
		})
		expect(replaced.note).toBe("Only this.")
		expect((await client.articles.get(colors)).noteLinks.from).toEqual([])
		expect(await client.articles.setNote(joel, null)).toMatchObject({ note: null })
		expect(await errorOf(client.articles.appendNote(MISSING, "x"))).toMatchObject({ status: 404 })
		const append = (text: string) =>
			request(`/api/v1/articles/${joel}/note/append`, {
				method: "POST",
				token: key,
				...json({ text }),
			})
		expect((await append("x".repeat(100_000))).status).toBe(200)
		const over = await append("more")
		expect(over.status).toBe(422)
		expect((await over.json()).error).toMatchObject({
			code: "note_too_long",
			message: expect.stringContaining("limited to 100000 characters"),
		})

		// Highlights: a repeated passage lists its occurrences; Markdown in the quote is tolerated.
		const ambiguous = await errorOf(client.highlights.create(joel, { quote: QUOTE }))
		expect(ambiguous).toMatchObject({ status: 409, code: "ambiguous_quote" })
		const candidates = errorDetails(ambiguous, "ambiguous_quote")?.candidates ?? []
		expect(candidates.map((c) => c.occurrence)).toEqual([1, 2])
		expect(candidates[0]?.context).toContain(`[${QUOTE}]`)
		expect(
			await errorOf(client.highlights.create(joel, { quote: QUOTE, occurrence: 3 })),
		).toMatchObject({ status: 409, message: "There are only 2 occurrences of that passage." })
		const created = await client.highlights.create(joel, {
			quote: QUOTE,
			occurrence: 2,
			note: `Like [Colors](${origin}/read/${colors})`,
			color: "pink",
		})
		expect(created.highlight).toMatchObject({
			quote: QUOTE,
			note: `Like [Colors](/read/${colors})`,
			color: "pink",
			article: { id: joel, title: JOEL.title },
		})
		// The text around the second occurrence, so clients can paint that one, not the first.
		const around = await db
			.select({ prefix: highlights.prefix, suffix: highlights.suffix })
			.from(highlights)
			.where(eq(highlights.id, created.highlight.id))
		expect(created.highlight).toMatchObject(around[0] ?? {})
		expect(created.highlight.prefix?.length).toBeGreaterThan(0)
		const linked = await client.highlights.create(joel, {
			quote: "Have you ever heard of [SEMA](http://www.sei.cmu.edu/sema/welcome.html)?",
		})
		expect(linked.highlight).toMatchObject({
			quote: "Have you ever heard of SEMA?",
			color: "yellow",
		})
		expect(
			await errorOf(client.highlights.create(joel, { quote: "Not in this article at all" })),
		).toMatchObject({ status: 422, code: "no_match" })
		expect(await errorOf(client.highlights.create(colors, { quote: "x" }))).toMatchObject({
			status: 422,
			code: "no_match",
		})
		const queued = await queuedArticle(owner)
		expect(await errorOf(client.highlights.create(queued, { quote: "x" }))).toMatchObject({
			status: 422,
			code: "not_ready",
		})
		expect(await errorOf(client.highlights.create(MISSING, { quote: "x" }))).toMatchObject({
			status: 404,
		})
		const raw = await request(`/api/v1/articles/${joel}/highlights`, {
			method: "POST",
			token: key,
			...json({ quote: "for measuring how good a software team is" }),
		})
		expect(raw.status).toBe(201)

		const edited = await client.highlights.update(created.highlight.id, {
			note: null,
			color: "blue",
		})
		expect(edited.highlight).toMatchObject({ id: created.highlight.id, note: null, color: "blue" })
		await expect(client.highlights.update(created.highlight.id, {})).rejects.toBeInstanceOf(
			KlipstackInputError,
		)

		// Its ends move, in the text of the version the reader shows; from a stale place, nothing.
		const { versionId } = await client.articles.html(joel)
		const [version] = await db
			.select({ text: documentVersions.text })
			.from(documentVersions)
			.where(eq(documentVersions.id, versionId))
		const at = (start: number, end: number) => ({
			start,
			end,
			quote: version!.text.slice(start, end),
		})
		const { start, end } = edited.highlight
		const longer = at(start, end + 12)
		const resized = await client.highlights.resize(created.highlight.id, {
			versionId,
			...longer,
			previous: at(start, end),
		})
		expect(resized.highlight).toMatchObject({
			id: created.highlight.id,
			start,
			end: end + 12,
			color: "blue",
		})
		expect(resized.highlight.quote.startsWith(QUOTE)).toBe(true)
		const resize = (body: Partial<Parameters<typeof client.highlights.resize>[1]>) =>
			errorOf(
				client.highlights.resize(created.highlight.id, {
					versionId,
					...at(start, end),
					previous: at(start, end),
					...body,
				}),
			)
		expect(await resize({})).toMatchObject({ status: 409, code: "highlight_changed" })
		expect(await resize({ previous: longer, quote: "Not the text" })).toMatchObject({
			status: 422,
			code: "no_match",
		})
		expect(await resize({ previous: longer, versionId: MISSING })).toMatchObject({
			status: 409,
			code: "version_changed",
		})
		expect(
			await errorOf(client.highlights.resize(MISSING, { versionId, ...longer, previous: longer })),
		).toMatchObject({ status: 404 })
		expect((await client.highlights.list({ article: joel })).items).toHaveLength(3)
		const removed = await request(`/api/v1/highlights/${created.highlight.id}`, {
			method: "DELETE",
			token: key,
		})
		expect(removed.status).toBe(204)
		expect(await client.highlights.delete(linked.highlight.id)).toBeUndefined()
		expect((await client.highlights.list({ article: joel })).items).toHaveLength(1)
		expect(await errorOf(client.highlights.delete(created.highlight.id))).toMatchObject({
			status: 404,
		})
		expect(
			await errorOf(client.highlights.update(created.highlight.id, { color: "green" })),
		).toMatchObject({ status: 404 })
		// Undo brings a deleted highlight back as it was, once; never someone else's.
		const stranger = await users.create("API Highlights stranger")
		expect(await errorOf(stranger.client.highlights.restore(linked.highlight.id))).toMatchObject({
			status: 404,
		})
		const restored = await client.highlights.restore(linked.highlight.id)
		expect(restored.highlight).toEqual(
			(await client.highlights.list({ article: joel })).items.find(
				(h) => h.id === linked.highlight.id,
			),
		)
		expect(restored.highlight).toMatchObject({
			id: linked.highlight.id,
			quote: linked.highlight.quote,
			note: linked.highlight.note,
			article: { id: joel },
		})
		expect((await client.highlights.list({ article: joel })).items).toHaveLength(2)
		expect(await errorOf(client.highlights.restore(linked.highlight.id))).toMatchObject({
			status: 404,
		})
		expect(await errorOf(client.highlights.restore(MISSING))).toMatchObject({ status: 404 })
		// Highlights of an article in the trash are gone with it.
		const remaining = (await client.highlights.list({ article: joel })).items[0]!.id
		await client.articles.trash([joel])
		expect(await errorOf(client.highlights.update(remaining, { color: "green" }))).toMatchObject({
			status: 404,
		})
		expect(await errorOf(client.highlights.restore(created.highlight.id))).toMatchObject({
			status: 404,
		})
	})

	it("the article's HTML, and a highlight by its place across paragraphs", async () => {
		const { id: owner, client } = await users.create("API Places")
		// Blocks with nothing between them, as extraction often leaves them: the stored text runs
		// "here.Second", while a reader shows (and a quote carries) a break between them.
		const article = finishArticle({
			html: "<p>First paragraph ends here.</p><p>Second paragraph starts here.</p><p>It ends here.</p>",
			fields: {
				title: "Places",
				author: null,
				siteName: null,
				description: null,
				language: "en",
				publishedAt: null,
				leadImageUrl: null,
				canonicalUrl: null,
			},
			extractor: { name: "test", version: "0" },
			minWords: 1,
		})
		const id = await insertArticle(owner, "Places", article.html)
		await db
			.update(documentVersions)
			.set({ text: article.text })
			.where(eq(documentVersions.documentId, id))

		const { versionId, html } = await client.articles.html(id)
		expect(html).toBe(article.html)
		expect(versionId).toBe((await getDocument(owner, id))?.currentVersionId)

		// The mobile reader: the selection, from the middle of one paragraph into the next.
		const body = new JSDOM(`<article>${html}</article>`).window.document.querySelector("article")!
		const [first, second] = Array.from(body.querySelectorAll("p"))
		const range = body.ownerDocument.createRange()
		range.setStart(first!.firstChild!, 6)
		range.setEnd(second!.firstChild!, 6)
		const selector = describeRange(range, body)!
		expect(selector.exact).toBe("paragraph ends here.Second")

		// By its text as shown, it is not found: the cause of the mobile refusal (row 62).
		expect(
			await errorOf(client.highlights.create(id, { quote: "paragraph ends here. Second" })),
		).toMatchObject({ status: 422, code: "no_match" })
		// By its place, it is.
		const { highlight } = await client.highlights.create(id, {
			quote: selector.exact,
			start: selector.start,
			end: selector.end,
			prefix: selector.prefix,
			suffix: selector.suffix,
		})
		expect(highlight).toMatchObject({
			quote: "paragraph ends here.Second",
			start: 6,
			end: 32,
			prefix: "First ",
			suffix: " paragraph starts here.It ends h",
		})
		expect((await client.articles.get(id)).highlights).toEqual([highlight])
		expect((await client.highlights.list({ article: id })).items).toEqual([highlight])

		// "ends here" twice: a quote alone is ambiguous, the place picks one.
		expect(await errorOf(client.highlights.create(id, { quote: "ends here" }))).toMatchObject({
			code: "ambiguous_quote",
		})
		const last = article.text.lastIndexOf("ends here")
		const repeated = await client.highlights.create(id, {
			quote: "ends here",
			start: last,
			end: last + 9,
		})
		expect(repeated.highlight).toMatchObject({
			start: last,
			end: last + 9,
			prefix: expect.stringMatching(/It $/),
		})
		// A place whose text is not the quote falls back to the quote.
		const moved = await client.highlights.create(id, { quote: "starts", start: 0, end: 6 })
		const starts = article.text.indexOf("starts")
		expect(moved.highlight).toMatchObject({ quote: "starts", start: starts, end: starts + 6 })

		await expect(client.articles.html(MISSING)).rejects.toMatchObject({ status: 404 })
		const queued = await queuedArticle(owner)
		expect(await errorOf(client.articles.html(queued))).toMatchObject({
			status: 422,
			code: "not_ready",
		})
	})

	it("opening an article and saving where the reader is", async () => {
		const { id: owner, key, client } = await users.create("API Reading")
		const id = await insertArticle(owner, "Long read", "<p>Words.</p>")
		expect(await client.articles.get(id)).toMatchObject({
			opened: false,
			progress: 0,
			position: 0,
			readingCycle: 0,
		})

		// Opening: no longer new; it returns where the reading stands.
		expect(await client.articles.open(id)).toEqual({ progress: 0, position: 0, cycle: 0 })
		expect((await client.articles.get(id)).opened).toBe(true)

		// The position moves both ways; progress keeps the furthest point.
		await client.articles.setPosition(id, 0.5, { cycle: 0 })
		await client.articles.setPosition(id, 0.25, { cycle: 0 })
		expect(await client.articles.get(id)).toMatchObject({ position: 0.25, progress: 0.5 })
		// A save from another reading cycle changes nothing.
		await client.articles.setPosition(id, 0.75, { cycle: 3 })
		expect((await client.articles.get(id)).position).toBe(0.25)

		// A finished inbox article opened a day later is read again, from a new cycle.
		await db
			.update(documents)
			.set({ readingProgress: 1, readingPosition: 1, lastReadAt: new Date(Date.now() - 2 * 864e5) })
			.where(eq(documents.id, id))
		expect(await client.articles.open(id)).toEqual({ progress: 0, position: 1, cycle: 1 })
		expect((await client.articles.get(id)).readingCycle).toBe(1)

		const outOfRange = await request(`/api/v1/articles/${id}/position`, {
			method: "PUT",
			token: key,
			...json({ position: 1.5 }),
		})
		expect(outOfRange.status).toBe(400)
		expect(await errorOf(client.articles.open(MISSING))).toMatchObject({ status: 404 })
		expect(await errorOf(client.articles.setPosition(MISSING, 0.5))).toMatchObject({ status: 404 })
	})

	it("the feed and followed feeds", async () => {
		const { email, key, client } = await users.create("API Feed Writer")
		const { otherUrl } = await seedFeeds(email)
		const listed = await client.feed.get()
		const [post3, post2, post1] = listed.feeds[0]!.items.map((i) => i.id)

		const saved = await client.feed.saveItems([post3!, MISSING, post3!])
		expect(saved).toEqual({
			saved: [{ itemId: post3, articleId: expect.any(String) }],
			notFound: [MISSING],
			notSaved: [],
		})
		expect(await client.feed.dismissItems([post2!, MISSING])).toEqual({
			dismissed: [post2],
			notFound: [MISSING],
		})
		const after = (await client.feed.get()).feeds[0]!
		expect(after.items.map((i) => i.id)).toEqual([post3, post1])
		expect(after.items[0]?.savedArticleId).toBe(saved.saved[0]?.articleId)
		expect((await client.articles.get(saved.saved[0]!.articleId)).status).toEqual(
			expect.any(String),
		)

		expect(await client.feed.markViewed(listed.listedAt)).toEqual({ viewedAt: listed.listedAt })
		expect((await client.feed.get({ newOnly: true })).feeds).toEqual([])
		const future = await client.feed.markViewed("2100-01-01T00:00:00Z")
		expect(Date.parse(future.viewedAt)).toBeLessThanOrEqual(Date.now())
		const yearZero = await request("/api/v1/feed/viewed", {
			method: "POST",
			token: key,
			...json({ asOf: "0000-01-01T00:00:00Z" }),
		})
		expect(yearZero.status).toBe(400)

		// Follow a known feed (no fetch): 201, then 200 when already followed.
		const follow = () =>
			request("/api/v1/feeds", { method: "POST", token: key, ...json({ url: otherUrl }) })
		const followed = await follow()
		expect(followed.status).toBe(201)
		const body = (await followed.json()) as { feed: { id: string } }
		expect(body).toMatchObject({
			feed: { title: "Other blog", newCount: 0, notUpdating: false },
			alreadyFollowing: false,
		})
		expect((await follow()).status).toBe(200)
		expect(await client.feeds.follow(otherUrl)).toMatchObject({
			feed: { id: body.feed.id },
			alreadyFollowing: true,
		})
		expect(await errorOf(client.feeds.follow("not a url"))).toMatchObject({
			status: 422,
			code: "invalid_url",
		})
		expect((await client.feeds.list()).items.map((f) => f.title)).toEqual([
			"Busy blog",
			"Other blog",
			"Quiet blog",
		])
		expect(await client.feeds.unfollow(body.feed.id)).toBeUndefined()
		expect(await errorOf(client.feeds.unfollow(body.feed.id))).toMatchObject({ status: 404 })
		expect((await client.feeds.list()).items).toHaveLength(2)
	})
})
