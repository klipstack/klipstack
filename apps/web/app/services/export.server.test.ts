import { strFromU8, unzipSync } from "fflate"
import { describe, expect, it } from "vitest"
import { EXPORT_LIMIT, rateLimit } from "~/lib/rate-limit.server"
import {
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

	it("lists articles with only a note in highlights.md", () => {
		const zip = unzipSync(
			bundleToZip({
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
	const zip = () =>
		unzipSync(
			bundleToZip({
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

	it("points an article's note at the sibling file, and highlights.md at articles/", () => {
		const files = zip()
		const article = strFromU8(files["articles/2026-09-01-an-article.md"]!)
		expect(article).toContain("See [Other](./2026-09-02-other.md) and")
		expect(article).toContain("also [Other](./2026-09-02-other.md)")
		const all = strFromU8(files["highlights.md"]!)
		expect(all).toContain("See [Other](articles/2026-09-02-other.md) and")
		expect(all).toContain("also [Other](articles/2026-09-02-other.md)")
	})

	it("drops the link, keeping the text, when the export has no file for the target", () => {
		const article = strFromU8(zip()["articles/2026-09-01-an-article.md"]!)
		expect(article).toContain("and Gone.")
		expect(article).not.toContain(GONE)
	})

	it("keeps the raw note text in the JSON bundle", () => {
		const bundle = JSON.parse(strFromU8(zip()["klipstack.json"]!)) as {
			documents: Array<{ note: string | null }>
		}
		expect(bundle.documents[0]?.note).toBe(
			`See [Other](/read/${TARGET}) and [Gone](/read/${GONE}).`,
		)
	})
})
