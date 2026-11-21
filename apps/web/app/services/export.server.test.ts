import {
	db,
	documents,
	documentTags,
	documentVersions,
	documentVia,
	eq,
	highlights,
	newId,
	tags,
	user,
} from "@klipstack/db"
import { strFromU8, unzipSync } from "fflate"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { EXPORT_LIMIT, rateLimit } from "~/lib/rate-limit.server"
import {
	buildExport,
	bundleToZip,
	documentMarkdown,
	downloadExport,
	type ExportedDocument,
} from "./export.server"

describe("export admission", () => {
	it("rejects before building when another entry point exhausted the quota", async () => {
		const userId = `export-quota-${crypto.randomUUID()}`
		for (let i = 0; i < EXPORT_LIMIT.limit; i++)
			rateLimit(`export:${userId}`, EXPORT_LIMIT.limit, EXPORT_LIMIT.windowMs)
		await expect(downloadExport(userId, "zip")).rejects.toMatchObject({ status: 429 })
	})
	it("bounds simultaneous exports without blocking an independent user", async () => {
		const userId = `export-concurrent-${crypto.randomUUID()}`
		const first = downloadExport(userId, "json")
		await expect(downloadExport(userId, "zip")).rejects.toMatchObject({
			status: 429,
			retryAfter: 2,
		})
		const second = downloadExport(`${userId}-other`, "json")
		expect((await first).contentType).toContain("json")
		expect((await second).contentType).toContain("json")
		expect((await downloadExport(userId, "json")).filename).toMatch(/^klipstack-.*\.json$/)
	})
})

const doc = (over: Partial<ExportedDocument> = {}): ExportedDocument => ({
	id: "d1",
	url: "https://example.com/a",
	canonicalUrl: null,
	title: "An article",
	author: null,
	siteName: null,
	description: null,
	language: null,
	wordCount: null,
	publishedAt: null,
	savedAt: "2026-09-01T00:00:00.000Z",
	location: "inbox",
	archivedAt: null,
	starred: false,
	shortlisted: false,
	finishedAt: null,
	readingHistory: [],
	markdown: "Body.",
	note: null,
	noteUpdatedAt: null,
	editionNote: null,
	tags: [],
	highlights: [],
	via: [],
	...over,
})

const quote = { id: "h1", exact: "a quote", note: "why", color: 0, createdAt: "" }

describe("posts an article was saved through, in the export", () => {
	it("quotes the post under the title, with who shared it and a link", () => {
		const md = documentMarkdown(
			doc({
				via: [
					{
						url: "https://x.com/a/status/1",
						author: "Ann",
						siteName: "X.com",
						publishedAt: null,
						markdown: "Read this:\n\n[the essay](https://example.com/a)",
					},
				],
			}),
		)
		expect(md).toContain(
			"# An article\n\n> Shared by Ann on X.com ([post](https://x.com/a/status/1)):\n>\n> Read this:\n> \n> [the essay](https://example.com/a)\n\nBody.",
		)
	})
})

describe("article note in the export", () => {
	it("puts the note between the body and the highlights", () => {
		const md = documentMarkdown(doc({ note: "My take.", highlights: [quote] }))
		expect(md).toContain("Body.\n\n## Note\n\nMy take.\n\n## Highlights\n\n> a quote\n\nwhy\n")
	})

	it("has no note section without a note", () => {
		expect(documentMarkdown(doc())).not.toContain("## Note")
	})

	it("lists articles with only a note in highlights.md", async () => {
		const zip = unzipSync(
			await bundleToZip({
				exportedAt: "",
				app: "klipstack",
				version: 1,
				tags: [],
				savedSearches: [],
				editions: [],
				documents: [doc({ note: "Only a note." }), doc({ id: "d2", title: "Nothing" })],
			}),
		)
		const all = strFromU8(zip["highlights.md"]!)
		expect(all).toContain("## [An article](https://example.com/a)\n\nOnly a note.")
		expect(all).not.toContain("Nothing")
	})
})

describe("tags in the export", () => {
	it("go in the front matter, only when there are any", () => {
		const md = documentMarkdown(doc({ tags: ["later", "web dev"] }))
		expect(md).toContain('finished: null\ntags: ["later", "web dev"]\n---')
		expect(documentMarkdown(doc())).not.toContain("tags:")
	})
})

const TARGET = "0193a5f1-2c3d-7e4f-8a9b-0c1d2e3f4a5b"
const GONE = "0193a5f1-2c3d-7e4f-8a9b-0c1d2e3f4a5c"

describe("note links in the export", () => {
	const zip = async () =>
		unzipSync(
			await bundleToZip({
				exportedAt: "",
				app: "klipstack",
				version: 1,
				tags: [],
				savedSearches: [],
				editions: [],
				documents: [
					doc({
						note: `See [Other](/read/${TARGET}) and [Gone](/read/${GONE}).`,
						highlights: [{ ...quote, note: `also [Other](/read/${TARGET})` }],
					}),
					doc({ id: TARGET, title: "Other", savedAt: "2026-09-02T00:00:00.000Z" }),
				],
			}),
		)

	it("points an article's note at the sibling file, and highlights.md at articles/", async () => {
		const files = await zip()
		const article = strFromU8(files["articles/2026-09-01-an-article.md"]!)
		expect(article).toContain("See [Other](./2026-09-02-other.md) and")
		expect(article).toContain("also [Other](./2026-09-02-other.md)")
		const all = strFromU8(files["highlights.md"]!)
		expect(all).toContain("See [Other](articles/2026-09-02-other.md) and")
		expect(all).toContain("also [Other](articles/2026-09-02-other.md)")
	})

	it("drops the link, keeping the text, when the export has no file for the target", async () => {
		const article = strFromU8((await zip())["articles/2026-09-01-an-article.md"]!)
		expect(article).toContain("and Gone.")
		expect(article).not.toContain(GONE)
	})

	it("keeps the raw note text in the JSON bundle", async () => {
		const bundle = JSON.parse(strFromU8((await zip())["klipstack.json"]!)) as {
			documents: Array<{ note: string | null }>
		}
		expect(bundle.documents[0]?.note).toBe(
			`See [Other](/read/${TARGET}) and [Gone](/read/${GONE}).`,
		)
	})
})

describe("building the export", () => {
	const userId = `test-export-${Date.now()}`
	beforeAll(async () => {
		await db.insert(user).values({ id: userId, name: "Reader", email: `${userId}@example.com` })
	})
	afterAll(async () => {
		await db.delete(user).where(eq(user.id, userId))
	})

	/** An article with its current version, a tag, a highlight and a post it came through. */
	async function article(title: string) {
		const [d] = await db
			.insert(documents)
			.values({ userId, sourceUrl: `https://example.com/${title}`, urlHash: newId(), title })
			.returning()
		const html = `<p>The body of ${title}.</p>`
		const [v] = await db
			.insert(documentVersions)
			.values({
				documentId: d!.id,
				version: 1,
				html,
				text: html,
				textHash: newId(),
				extractor: "test",
				extractorVersion: "0",
			})
			.returning()
		await db.update(documents).set({ currentVersionId: v!.id }).where(eq(documents.id, d!.id))
		const [tag] = await db.insert(tags).values({ userId, name: title }).returning()
		await db.insert(documentTags).values({ documentId: d!.id, tagId: tag!.id })
		await db.insert(highlights).values({
			documentId: d!.id,
			userId,
			versionId: v!.id,
			exact: "body",
			prefix: "",
			suffix: "",
			startOffset: 4,
			endOffset: 8,
		})
		await db.insert(documentVia).values({
			documentId: d!.id,
			userId,
			url: `https://social.example/${title}`,
			urlHash: newId(),
			html: "<p>A post.</p>",
		})
	}

	/** Queries `buildExport` sends to the database. */
	async function queries() {
		const spy = vi.spyOn(db.$client, "query")
		try {
			const bundle = await buildExport(userId)
			return { bundle, count: spy.mock.calls.length }
		} finally {
			spy.mockRestore()
		}
	}

	it("sends as many queries for many articles as for one", async () => {
		await article("first")
		const one = await queries()
		expect(one.bundle.documents[0]).toMatchObject({
			markdown: "The body of first.",
			tags: ["first"],
			highlights: [{ exact: "body" }],
			via: [{ markdown: "A post." }],
		})
		for (const title of ["second", "third", "fourth"]) await article(title)
		const four = await queries()
		expect(four.bundle.documents.map((d) => d.markdown)).toEqual([
			"The body of first.",
			"The body of second.",
			"The body of third.",
			"The body of fourth.",
		])
		expect(four.count).toBe(one.count)
	})

	it("lets other work run while it builds and zips", async () => {
		let turns = 0
		let running = true
		const count = () => {
			turns++
			if (running) setImmediate(count)
		}
		setImmediate(count)
		const bundle = await buildExport(userId)
		const built = turns
		const zip = await bundleToZip({
			...bundle,
			// Several slices of compression.
			documents: bundle.documents.map((d) => ({ ...d, markdown: d.markdown.repeat(20_000) })),
		})
		running = false
		expect(built).toBeGreaterThan(bundle.documents.length)
		expect(turns - built).toBeGreaterThan(5)
		const files = unzipSync(zip)
		const names = Object.keys(files)
		expect(names.slice(0, -3).every((name) => name.startsWith("articles/"))).toBe(true)
		expect(names.slice(-3)).toEqual(["highlights.md", "klipstack.json", "README.md"])
		expect(strFromU8(files["klipstack.json"]!)).toContain("The body of first.".repeat(20_000))
	})
})
