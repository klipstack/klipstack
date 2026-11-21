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
import { afterAll, describe, expect, it, vi } from "vitest"
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
	const owners: string[] = []
	afterAll(async () => {
		for (const id of owners) await db.delete(user).where(eq(user.id, id))
	})
	async function account() {
		const id = `test-export-${crypto.randomUUID()}`
		owners.push(id)
		await db.insert(user).values({ id, name: "Reader", email: `${id}@example.com` })
		return id
	}

	async function version(documentId: string, html: string, number = 1) {
		const [v] = await db
			.insert(documentVersions)
			.values({
				documentId,
				version: number,
				html,
				text: html,
				textHash: newId(),
				extractor: "test",
				extractorVersion: "0",
			})
			.returning()
		await db.update(documents).set({ currentVersionId: v!.id }).where(eq(documents.id, documentId))
		return v!
	}

	/** An article with its current version, a tag, a highlight and a post it came through. */
	async function article(userId: string, title: string) {
		const [d] = await db
			.insert(documents)
			.values({ userId, sourceUrl: `https://example.com/${title}`, urlHash: newId(), title })
			.returning()
		const v = await version(d!.id, `<p>The body of ${title}.</p>`)
		const [tag] = await db.insert(tags).values({ userId, name: title }).returning()
		await db.insert(documentTags).values({ documentId: d!.id, tagId: tag!.id })
		await db.insert(highlights).values({
			documentId: d!.id,
			userId,
			versionId: v.id,
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
		return d!
	}

	/** Queries `buildExport` sends to the database. */
	async function queries(userId: string) {
		const spy = vi.spyOn(db.$client, "query")
		try {
			const bundle = await buildExport(userId)
			return { bundle, count: spy.mock.calls.length }
		} finally {
			spy.mockRestore()
		}
	}

	/** How long, at most, `work` held the event loop between two turns of other work. */
	async function longestHold<T>(work: () => Promise<T>) {
		let longest = 0
		let last = performance.now()
		let running = true
		const tick = () => {
			const now = performance.now()
			longest = Math.max(longest, now - last)
			last = now
			if (running) setImmediate(tick)
		}
		setImmediate(tick)
		const started = performance.now()
		try {
			const result = await work()
			return { result, longest, total: performance.now() - started }
		} finally {
			running = false
		}
	}

	it("sends as many queries for many articles as for one", async () => {
		const userId = await account()
		await article(userId, "first")
		const one = await queries(userId)
		expect(one.bundle.documents[0]).toMatchObject({
			markdown: "The body of first.",
			tags: ["first"],
			highlights: [{ exact: "body" }],
			via: [{ markdown: "A post." }],
		})
		for (const title of ["second", "third", "fourth"]) await article(userId, title)
		const four = await queries(userId)
		expect(four.bundle.documents.map((d) => d.markdown)).toEqual([
			"The body of first.",
			"The body of second.",
			"The body of third.",
			"The body of fourth.",
		])
		expect(four.count).toBe(one.count)
	})

	it("lets other work run between articles", async () => {
		const userId = await account()
		// Enough HTML that turning it into Markdown takes a while.
		const body =
			"<p>A paragraph with <em>some</em> <a href='https://example.com'>links</a>.</p>".repeat(2_000)
		for (let i = 0; i < 20; i++) {
			const [d] = await db
				.insert(documents)
				.values({ userId, sourceUrl: `https://example.com/${i}`, urlHash: newId(), title: `${i}` })
				.returning()
			await version(d!.id, body)
		}
		const { result, longest, total } = await longestHold(() => buildExport(userId))
		expect(result.documents).toHaveLength(20)
		// One article at a time, not all twenty in one go.
		expect(longest).toBeLessThan(total / 5)
	})

	it("exports the version an article had when the export began, if it changes meanwhile", async () => {
		const userId = await account()
		const d = await article(userId, "before")
		const original = db.$client.query.bind(db.$client) as (...args: unknown[]) => Promise<unknown>
		let changed = false
		// Stands in for an extraction that lands between the article list and the versions query.
		const spy = vi.spyOn(db.$client, "query").mockImplementation((async (...args: unknown[]) => {
			const result = await original(...args)
			if (!changed) {
				changed = true
				await version(d.id, "<p>Extracted again.</p>", 2)
			}
			return result
		}) as never)
		try {
			expect((await buildExport(userId)).documents[0]?.markdown).toBe("The body of before.")
		} finally {
			spy.mockRestore()
		}
		expect((await buildExport(userId)).documents[0]?.markdown).toBe("Extracted again.")
	})
})

describe("zipping the export", () => {
	it("lets other work run while it compresses, and keeps every file", async () => {
		const documents = [doc(), doc({ id: "d2", title: "Second", markdown: "" })]
		const big = { ...documents[0]!, markdown: "A long body. ".repeat(100_000) }
		let turns = 0
		let running = true
		const count = () => {
			turns++
			if (running) setImmediate(count)
		}
		setImmediate(count)
		const zip = await bundleToZip({
			exportedAt: "2026-09-03T00:00:00.000Z",
			app: "klipstack",
			version: 1,
			tags: [],
			savedSearches: [],
			editions: [],
			documents: [big, documents[1]!],
		})
		running = false
		// Over 1 MB of Markdown, twice (its file and the JSON): many 64 KB slices.
		expect(turns).toBeGreaterThan(20)
		const files = unzipSync(zip)
		expect(Object.keys(files)).toEqual([
			"articles/2026-09-01-an-article.md",
			"articles/2026-09-01-second.md",
			"highlights.md",
			"klipstack.json",
			"README.md",
		])
		expect(strFromU8(files["articles/2026-09-01-an-article.md"]!)).toBe(
			documentMarkdown(big, (id) =>
				id === "d1" ? "./2026-09-01-an-article.md" : id === "d2" ? "./2026-09-01-second.md" : null,
			),
		)
		expect(strFromU8(files["highlights.md"]!)).toBe("# Highlights\n\n\n")
	})
})
