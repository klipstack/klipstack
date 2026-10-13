import { createHash } from "node:crypto"
import { db, documents, documentVersions, eq, highlights, user as userTable } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { getUser, requireUser } from "~/lib/session.server"
import { loader as apiSearch } from "./api.search"
import { loader as searchPage } from "./search"

// Only the session stands in: the searches run against the real database.
vi.mock("~/lib/session.server", async (original) => ({
	...(await original<typeof import("~/lib/session.server")>()),
	getUser: vi.fn(),
	requireUser: vi.fn(),
}))

const userId = `test-search-groups-${Date.now()}`

beforeAll(async () => {
	await db.insert(userTable).values({ id: userId, name: "S", email: `${userId}@example.com` })
	vi.mocked(getUser).mockReturnValue({ id: userId } as never)
	vi.mocked(requireUser).mockReturnValue({ id: userId } as never)
	const text = Array.from({ length: 6 }, (_, i) => `Gryphon sighting number ${i}.`).join(" ")
	const [doc] = await db
		.insert(documents)
		.values({
			userId,
			sourceUrl: "https://example.com/gryphons",
			urlHash: `${userId}-gryphons`,
			status: "ready",
			title: "Field log",
			note: "Gryphon nests by the cliff",
		})
		.returning({ id: documents.id })
	const [version] = await db
		.insert(documentVersions)
		.values({
			documentId: doc!.id,
			version: 1,
			html: `<p>${text}</p>`,
			text,
			textHash: createHash("sha256").update(text).digest("hex"),
			extractor: "test",
			extractorVersion: "0",
		})
		.returning({ id: documentVersions.id })
	await db.insert(highlights).values(
		Array.from({ length: 6 }, (_, i) => {
			const exact = `Gryphon sighting number ${i}.`
			return {
				documentId: doc!.id,
				userId,
				versionId: version!.id,
				startOffset: text.indexOf(exact),
				endOffset: text.indexOf(exact) + exact.length,
				exact,
			}
		}),
	)
})

afterAll(async () => {
	await db.delete(userTable).where(eq(userTable.id, userId))
})

const page = (query: string) =>
	searchPage({
		request: new Request(`http://localhost/search?${query}`),
		context: {},
	} as never) as Promise<{
		highlights: { items: unknown[]; total: number }
		notes: { items: unknown[]; total: number }
		expanded: string | null
	}>

describe("the search page's groups", () => {
	it("shows the first few of each group, all of one when asked, and only on the first page", async () => {
		const first = await page("q=gryphon")
		expect(first.highlights.items).toHaveLength(5)
		expect(first.highlights.total).toBe(6)
		expect(first.notes.total).toBe(1)
		expect(first.expanded).toBeNull()

		const all = await page("q=gryphon&all=highlights")
		expect(all.highlights.items).toHaveLength(6)
		expect(all.expanded).toBe("highlights")

		const second = await page("q=gryphon&page=2")
		expect(second.highlights).toEqual({ items: [], total: 0 })
		expect(second.notes).toEqual({ items: [], total: 0 })
	})
})

describe("/api/search", () => {
	const api = (query: string) =>
		apiSearch({
			request: new Request(`http://localhost/api/search?${query}`),
			context: {},
		} as never) as Promise<{ items: unknown[]; highlights: unknown[]; notes: unknown[] }>

	it("adds highlights and notes for the palette only", async () => {
		const palette = await api("annotations=1&q=gryph")
		expect(palette.highlights).toHaveLength(5)
		expect(palette.notes).toEqual([
			expect.objectContaining({ title: "Field log", note: "Gryphon nests by the cliff" }),
		])

		// The note link menu asks without it: articles only.
		const menu = await api("q=gryph")
		expect(menu.highlights).toEqual([])
		expect(menu.notes).toEqual([])
		// Nothing typed: recent articles, no highlights.
		const blank = await api("annotations=1&q=")
		expect(blank.items.length).toBeGreaterThan(0)
		expect(blank.highlights).toEqual([])
	})
})
