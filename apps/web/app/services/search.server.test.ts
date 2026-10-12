import { CAPTURE_SOURCES } from "@klipstack/api-contract/enums"
import {
	captureSource,
	db,
	documentSearchVector,
	documents,
	documentVersions,
	eq,
	highlights,
	inArray,
	user as userTable,
} from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { updateArticle } from "~/commands/articles.server"
import {
	keepsArchived,
	operatorValues,
	quickFind,
	recentDocuments,
	searchDocuments,
} from "./search.server"

const userId = `test-search-${Date.now()}`
/** Owns the extracted articles, so they stay out of the first user's recent list. */
const readerId = `${userId}-reader`
/** Owns the articles the operators tell apart. */
const opsId = `${userId}-ops`
const ids: Record<string, string> = {}

async function addDocument(
	title: string,
	lastReadAt: Date | null,
	owner = userId,
): Promise<string> {
	const [d] = await db
		.insert(documents)
		.values({
			userId: owner,
			sourceUrl: `https://example.com/${encodeURIComponent(title)}`,
			urlHash: `${owner}-${title}`,
			title,
			status: "ready",
			lastReadAt,
		})
		.returning({ id: documents.id })
	return d!.id
}

/** An extracted article: its search vector is built the way the worker builds it. */
async function addArticle(
	title: string,
	body: string,
	{ language = null, note = null }: { language?: string | null; note?: string | null } = {},
): Promise<string> {
	const id = await addDocument(title, null, readerId)
	await db
		.update(documents)
		.set({ language, note, search: documentSearchVector({ title, author: null, body, language }) })
		.where(eq(documents.id, id))
	return id
}

const titles = async (q: string) =>
	(await searchDocuments({ userId: readerId, q })).items.map((d) => d.title)

type Options = Omit<Parameters<typeof searchDocuments>[0], "userId" | "q">
/** Titles of the operator user's matches, without the word they all share. */
const found = async (q: string, options: Options = {}) =>
	(await searchDocuments({ userId: opsId, q, ...options })).items.map((d) =>
		d.title?.replace("Quokka ", ""),
	)

async function addQuokka(name: string, values: Partial<typeof documents.$inferInsert>) {
	const title = `Quokka ${name}`
	const [d] = await db
		.insert(documents)
		.values({
			userId: opsId,
			sourceUrl: `https://example.com/${name}`,
			urlHash: `${opsId}-${name}`,
			title,
			status: "ready",
			...values,
		})
		.returning({ id: documents.id })
	await db
		.update(documents)
		.set({ search: documentSearchVector({ title, author: null, body: "", language: null }) })
		.where(eq(documents.id, d!.id))
	return d!.id
}

beforeAll(async () => {
	await db.insert(userTable).values([
		{ id: userId, name: "S", email: `${userId}@example.com` },
		{ id: readerId, name: "R", email: `${readerId}@example.com` },
		{ id: opsId, name: "O", email: `${opsId}@example.com` },
	])
	ids.never = await addDocument("never read", null)
	ids.old = await addDocument("read a while ago", new Date("2026-01-01"))
	ids.recent = await addDocument("read just now", new Date("2026-09-01"))
	ids.gone = await addDocument("in the trash", new Date("2026-09-02"))
	await db.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, ids.gone!))
	await addArticle("Firewalls", "The firewall was blocking every request from the office.")
	await addArticle("Una decisión difícil", "Los programadores eligieron el camino más largo.")
	await addArticle("Vivre ensemble", "Toutes les maisons du village sont anciennes.", {
		language: "fr",
	})
	await addArticle("Office plants", "A fern wants shade.", { note: "Mis pensamientos sobre riego" })

	await addQuokka("inbox", {
		createdAt: new Date("2026-03-10T12:00:00Z"),
		siteName: "The Daily Plânet",
		sourceUrl: "https://www.planet.example/100%_true",
		author: "Lois Lane",
		readingMinutes: 5,
	})
	await addQuokka("archived", {
		createdAt: new Date("2026-05-20T12:00:00Z"),
		archivedAt: new Date("2026-05-21T12:00:00Z"),
		starredAt: new Date("2026-05-21T12:00:00Z"),
		shortlistedAt: new Date("2026-05-21T12:00:00Z"),
		firstOpenedAt: new Date("2026-05-21T12:00:00Z"),
		readAt: new Date("2026-05-21T12:00:00Z"),
		siteName: "Ars",
		sourceUrl: "https://arstechnica.example/b",
		author: "José Peña",
		readingMinutes: 40,
		captureSource: "extension",
	})
	// Saved on August 1 in UTC, and on August 2 in Madrid.
	const reading = await addQuokka("reading", {
		createdAt: new Date("2026-08-01T23:30:00Z"),
		publishedAt: new Date("2020-01-15T12:00:00Z"),
		firstOpenedAt: new Date("2026-08-02T12:00:00Z"),
		readingProgress: 0.4,
		note: "remember the wombat",
		captureSource: "feed",
	})
	await addQuokka("trashed", {
		createdAt: new Date("2026-06-01T12:00:00Z"),
		starredAt: new Date("2026-06-01T12:00:00Z"),
		deletedAt: new Date("2026-06-02T12:00:00Z"),
		captureSource: "api",
	})
	await addQuokka("failed", { createdAt: new Date("2026-07-01T12:00:00Z"), status: "failed" })
	const [version] = await db
		.insert(documentVersions)
		.values({
			documentId: reading,
			version: 1,
			html: "<p>one two</p>",
			text: "one two",
			textHash: "test",
			extractor: "test",
			extractorVersion: "0",
		})
		.returning({ id: documentVersions.id })
	const highlight = { documentId: reading, userId: opsId, versionId: version!.id, exact: "one" }
	await db.insert(highlights).values({ ...highlight, startOffset: 0, endOffset: 3 })
	// A deleted highlight is not a highlight.
	const archived = await db.query.documents.findFirst({
		where: eq(documents.urlHash, `${opsId}-archived`),
	})
	const [other] = await db
		.insert(documentVersions)
		.values({
			documentId: archived!.id,
			version: 1,
			html: "<p>one</p>",
			text: "one",
			textHash: "test",
			extractor: "test",
			extractorVersion: "0",
		})
		.returning({ id: documentVersions.id })
	await db.insert(highlights).values({
		...highlight,
		documentId: archived!.id,
		versionId: other!.id,
		startOffset: 0,
		endOffset: 3,
		deletedAt: new Date(),
	})
})

afterAll(async () => {
	await db.delete(userTable).where(inArray(userTable.id, [userId, readerId, opsId]))
})

describe("recentDocuments", () => {
	it("puts the last read first, never-read last, and leaves out the trash", async () => {
		const rows = await recentDocuments({ userId })
		expect(rows.map((d) => d.title)).toEqual(["read just now", "read a while ago", "never read"])
	})

	it("drops the excluded article and honours the limit", async () => {
		const rows = await recentDocuments({ userId, exclude: ids.recent, limit: 1 })
		expect(rows.map((d) => d.title)).toEqual(["read a while ago"])
	})
})

describe("searchDocuments", () => {
	it("drops NUL characters instead of failing", async () => {
		const nul = String.fromCharCode(0)
		const rows = await searchDocuments({ userId, q: `just${nul} now` })
		expect(rows.items.map((d) => d.title)).toEqual(["read just now"])
		expect((await searchDocuments({ userId, q: nul })).items).toEqual([])
	})

	it("finds the variants of a word", async () => {
		expect(await titles("blocked requests")).toEqual(["Firewalls"])
		expect(await titles("programador")).toEqual(["Una decisión difícil"])
	})

	it("stems in the article's language when it is on record", async () => {
		expect(await titles("maison")).toEqual(["Vivre ensemble"])
	})

	it("ignores accents, in the query and in the article", async () => {
		expect(await titles("decision dificil")).toEqual(["Una decisión difícil"])
		expect(await titles("más")).toEqual(["Una decisión difícil"])
		expect(await titles("fírewall")).toEqual(["Firewalls"])
	})

	it("still finds exact phrases and stop words", async () => {
		expect(await titles('"blocking every request"')).toEqual(["Firewalls"])
		expect(await titles('"every blocking"')).toEqual([])
		// The exact words and their variants share a vector: no phrase runs from one into the other.
		expect(await titles('"office the firewall"')).toEqual([])
		expect(await titles('"plants office"')).toEqual([])
		expect(await titles("was")).toEqual(["Firewalls"])
	})

	it("searches the note too", async () => {
		expect(await titles("pensamiento")).toEqual(["Office plants"])
	})

	it("falls back to the articles with the most words when none has them all", async () => {
		expect(await titles("office firewall zebra")).toEqual(["Firewalls", "Office plants"])
	})

	it("does not fall back on stop words, quotes or exclusions", async () => {
		expect(await titles("the zebra")).toEqual([])
		expect(await titles('"firewall zebra"')).toEqual([])
		expect(await titles("zebra -firewall")).toEqual([])
	})

	it("finds an edited title by its variants", async () => {
		const id = await addArticle("Untitled", "Nothing to see.", { language: "es" })
		await updateArticle(readerId, id, { title: "Canciones olvidadas" })
		expect(await titles("cancion olvidada")).toEqual(["Canciones olvidadas"])
	})

	it("fits the longest article with no repeated word in a vector", async () => {
		const words = Array.from({ length: 50_000 }, (_, i) => `w${i.toString(36)}xing`)
		await addArticle("Every word once", words.join(" "))
		expect(await titles(words[10]!)).toEqual(["Every word once"])
	})
})

describe("search operators", () => {
	const ALL = ["reading", "failed", "archived", "inbox"]

	it("searches the inbox and the archive unless told where", async () => {
		expect(await found("quokka sort:newest")).toEqual(ALL)
		expect(await found("quokka in:library sort:newest")).toEqual(["reading", "failed", "inbox"])
		expect(await found("quokka in:archive")).toEqual(["archived"])
		expect(await found("quokka in:trash")).toEqual(["trashed"])
		expect(await found("quokka in:anywhere sort:oldest")).toEqual([
			"inbox",
			"archived",
			"trashed",
			"failed",
			"reading",
		])
	})

	it("widens with repeats of in:, site:, author: and via:", async () => {
		expect(await found("quokka in:archive in:trash sort:oldest")).toEqual(["archived", "trashed"])
		expect(await found("quokka in:trash in:anywhere sort:newest")).toHaveLength(5)
		expect(await found("site:ars site:planet sort:oldest")).toEqual(["inbox", "archived"])
		expect(await found("author:lois author:jose sort:oldest")).toEqual(["inbox", "archived"])
		expect(await found("via:feed via:extension sort:oldest")).toEqual(["archived", "reading"])
	})

	it("narrows with repeats of is:, has: and title:", async () => {
		expect(await found("is:starred")).toEqual(["archived"])
		expect(await found("is:shortlisted")).toEqual(["archived"])
		expect(await found("is:starred is:unread")).toEqual([])
		expect(await found("has:note has:highlights")).toEqual(["reading"])
		expect(await found("title:quokka title:fail")).toEqual(["failed"])
	})

	it("tells the reading states apart", async () => {
		expect(await found("is:unread")).toEqual(["inbox"])
		expect(await found("is:reading")).toEqual(["reading"])
		expect(await found("is:finished")).toEqual(["archived"])
		expect(await found("is:failed")).toEqual(["failed"])
		expect(await found("is:quick")).toEqual(["inbox"])
		expect(await found("is:long")).toEqual(["archived"])
		expect(await found("in:trash is:starred")).toEqual(["trashed"])
	})

	it("negates, counting a missing value as no match", async () => {
		expect(await found("-is:finished sort:oldest")).toEqual(["inbox", "failed", "reading"])
		// Only one article has a length that is not quick; two have none.
		expect(await found("-is:quick sort:oldest")).toEqual(["archived", "failed", "reading"])
		expect(await found("-author:lois sort:oldest")).toEqual(["archived", "failed", "reading"])
		expect(await found("-in:archive sort:oldest")).toEqual(["inbox", "failed", "reading"])
		expect(await found("quokka -in:trash sort:newest")).toEqual(ALL)
		expect(await found("-has:note -via:web")).toEqual(["archived"])
	})

	it("matches text values as substrings, whatever the case and the accents", async () => {
		expect(await found("site:PLANET")).toEqual(["inbox"])
		expect(await found("site:planet.example")).toEqual(["inbox"])
		expect(await found('site:"daily planet"')).toEqual(["inbox"])
		expect(await found("author:pena")).toEqual(["archived"])
		// The host, not the path.
		expect(await found("site:true")).toEqual([])
	})

	it("takes % and _ as themselves", async () => {
		expect(await found("title:%")).toEqual([])
		expect(await found("title:_")).toEqual([])
		expect(await found("100%_true")).toEqual(["inbox"])
		expect(await found("100%true")).toEqual([])
	})

	it("has highlights only while one is not deleted", async () => {
		expect(await found("has:highlights")).toEqual(["reading"])
		expect(await found("has:note")).toEqual(["reading"])
	})

	it("filters by the saved and the published date", async () => {
		expect(await found("saved:2026-05")).toEqual(["archived"])
		expect(await found("saved:2026-03..2026-05 sort:oldest")).toEqual(["inbox", "archived"])
		expect(await found("saved:>=2026-07 sort:oldest")).toEqual(["failed", "reading"])
		expect(await found("after:2026-07-01 before:2026-08-01")).toEqual(["failed"])
		expect(await found("published:2020")).toEqual(["reading"])
		expect(await found("published:<2030")).toEqual(["reading"])
		expect(await found("saved:2025")).toEqual([])
	})

	it("counts days where the user is", async () => {
		expect(await found("saved:2026-08-01")).toEqual(["reading"])
		expect(await found("saved:2026-08-01", { timeZone: "Europe/Madrid" })).toEqual([])
		expect(await found("saved:2026-08-02", { timeZone: "Europe/Madrid" })).toEqual(["reading"])
		// Not zones: a POSIX offset (Postgres reads its sign the other way round) and a made-up name.
		expect(await found("saved:2026-08-01", { timeZone: "+02:00" })).toEqual(["reading"])
		expect(await found("saved:2026-08-01", { timeZone: "Mars/Olympus" })).toEqual(["reading"])
	})

	it("reads relative dates from today", async () => {
		const id = await addQuokka("fresh", {})
		expect(await found("saved:1d")).toEqual(["fresh"])
		expect(await found("saved:2w sort:oldest")).toEqual(["fresh"])
		expect(await found("-is:failed saved:1y sort:newest")).toContain("fresh")
		await db.delete(documents).where(eq(documents.id, id))
	})

	it("sorts, by the saved date without words", async () => {
		expect(await found("in:library")).toEqual(["reading", "failed", "inbox"])
		expect(await found("in:library sort:relevance")).toEqual(["reading", "failed", "inbox"])
		expect(await found("in:library sort:oldest")).toEqual(["inbox", "failed", "reading"])
		expect(await found("quokka sort:shortest")).toEqual(["inbox", "archived", "failed", "reading"])
		expect(await found("quokka sort:longest")).toEqual(["archived", "inbox", "reading", "failed"])
	})

	it("keeps the filters when it falls back to the articles with most words", async () => {
		expect(await found("quokka zebra in:archive")).toEqual(["archived"])
		expect(await found("quokka zebra is:unread")).toEqual(["inbox"])
		expect(await found("quokka zebra in:archive is:unread")).toEqual([])
	})

	it("pages without gaps or repeats", async () => {
		const pages = []
		let offset: number | null = 0
		while (offset !== null) {
			const page = await searchDocuments({
				userId: opsId,
				q: "quokka sort:oldest",
				limit: 3,
				offset,
			})
			pages.push(page.items.map((d) => d.title?.replace("Quokka ", "")))
			offset = page.nextOffset
		}
		expect(pages).toEqual([["inbox", "archived", "failed"], ["reading"]])
		const last = await searchDocuments({ userId: opsId, q: "quokka", limit: 4 })
		expect(last.nextOffset).toBeNull()
		const beyond = await searchDocuments({ userId: opsId, q: "quokka", limit: 3, offset: 90 })
		expect(beyond).toMatchObject({ items: [], nextOffset: null })
	})

	it("pages the fallback too, and not past the end of full matches", async () => {
		const first = await searchDocuments({ userId: opsId, q: "quokka zebra", limit: 3 })
		expect(first.items).toHaveLength(3)
		const second = await searchDocuments({
			userId: opsId,
			q: "quokka zebra",
			limit: 3,
			offset: first.nextOffset!,
		})
		expect(second.items).toHaveLength(1)
		const beyond = await searchDocuments({ userId: opsId, q: "quokka", limit: 3, offset: 6 })
		expect(beyond.items).toEqual([])
	})

	it("shows the matches in the trash apart, on the first page of a search that is not placed", async () => {
		const trash = async (q: string, options: Options = {}) =>
			(await searchDocuments({ userId: opsId, q, ...options })).trash
		expect(await trash("quokka")).toMatchObject({ total: 1, items: [{ title: "Quokka trashed" }] })
		expect(await trash("is:starred")).toMatchObject({ total: 1 })
		expect(await trash("quokka zebra")).toMatchObject({ total: 1 })
		expect(await trash("quokka in:library")).toBeNull()
		expect(await trash("quokka -in:trash")).toBeNull()
		expect(await trash("quokka", { limit: 3, offset: 3 })).toBeNull()
		// Nothing in the trash is finished.
		expect(await trash("is:finished")).toBeNull()
	})

	it("caps the trash group and still counts it all", async () => {
		const extra = []
		for (let i = 0; i < 6; i++) extra.push(await addQuokka(`gone ${i}`, { deletedAt: new Date() }))
		const { trash } = await searchDocuments({ userId: opsId, q: "quokka" })
		expect(trash?.items).toHaveLength(5)
		expect(trash?.total).toBe(7)
		await db.delete(documents).where(inArray(documents.id, extra))
	})

	it("reports what it did not understand, and searches without it", async () => {
		const result = await searchDocuments({ userId: opsId, q: "quokka is:unred in:archive" })
		expect(result.ignored).toEqual(["is:unred"])
		expect(result.items.map((d) => d.title)).toEqual(["Quokka archived"])
		const blank = await searchDocuments({ userId: opsId, q: "is:unred sort:oldest" })
		expect(blank).toEqual({ items: [], nextOffset: null, ignored: ["is:unred"], trash: null })
	})

	it("never finds another user's articles", async () => {
		expect((await searchDocuments({ userId, q: "quokka in:anywhere" })).items).toEqual([])
		expect((await searchDocuments({ userId, q: "is:starred" })).items).toEqual([])
	})

	it("knows the same capture sources as the database", () => {
		expect(CAPTURE_SOURCES).toEqual(captureSource)
	})
})

describe("quickFind", () => {
	const quick = async (q: string, options: { limit?: number; exclude?: string } = {}) =>
		(await quickFind({ userId: opsId, q, ...options })).map((d) => d.title?.replace("Quokka ", ""))

	it("matches as far as a word is typed, whatever the case and the accents", async () => {
		expect(await quick("quok")).toEqual(["reading", "failed", "archived", "inbox"])
		expect(await quick("QUOKKA ARCH")).toEqual(["archived"])
		expect(await quick("jose")).toEqual(["archived"])
	})

	it("looks in the title, the site, the author and the address, a word at a time", async () => {
		expect(await quick("quokka lois")).toEqual(["inbox"])
		expect(await quick("daily planet")).toEqual(["inbox"])
		expect(await quick("arstechnica")).toEqual(["archived"])
		expect(await quick("quokka wombat")).toEqual([])
	})

	it("is not the search: no body, no note, no operators, no trash", async () => {
		expect(await quick("wombat")).toEqual([])
		expect(await quick("quokka in:archive")).toEqual([])
		expect(await quick("is:starred")).toEqual([])
		expect(await quick("trashed")).toEqual([])
		expect(await quick("  ")).toEqual([])
	})

	it("puts the titles with all the words first, then the last read", async () => {
		const mention = await addQuokka("newer", { sourceUrl: "https://example.com/inbox-mention" })
		expect(await quick("inbox")).toEqual(["inbox", "newer"])
		const [read] = await db
			.update(documents)
			.set({ lastReadAt: new Date() })
			.where(eq(documents.urlHash, `${opsId}-inbox`))
			.returning({ id: documents.id })
		expect((await quick("quokka"))[0]).toBe("inbox")
		await db.update(documents).set({ lastReadAt: null }).where(eq(documents.id, read!.id))
		await db.delete(documents).where(eq(documents.id, mention))
	})

	it("drops the excluded article and honours the limit", async () => {
		const [first] = await quickFind({ userId: opsId, q: "quokka", limit: 1 })
		expect(first?.title).toBe("Quokka reading")
		expect(await quick("quokka", { limit: 1, exclude: first!.id })).toEqual(["failed"])
	})

	it("takes % and _ as themselves, and never finds another user's articles", async () => {
		expect(await quick("%")).toEqual(["inbox"])
		expect(await quickFind({ userId, q: "quokka" })).toEqual([])
	})
})

describe("operatorValues", () => {
	const values = (key: "site" | "author", q = "") => operatorValues({ userId: opsId, key, q })

	it("lists the sites by their address without www., most articles first", async () => {
		// Three live articles are at example.com; the trashed one does not count.
		expect(await values("site")).toEqual(["example.com", "arstechnica.example", "planet.example"])
		expect(await values("site", "PLAN")).toEqual(["planet.example"])
		expect(await values("site", "www")).toEqual([])
	})

	it("lists the authors as stored, whatever the case and the accents of what is typed", async () => {
		expect(await values("author")).toEqual(["José Peña", "Lois Lane"])
		expect(await values("author", "pena")).toEqual(["José Peña"])
		expect(await values("author", "%")).toEqual([])
	})

	it("honours the limit and never lists another user's values", async () => {
		expect(await operatorValues({ userId: opsId, key: "site", q: "", limit: 1 })).toEqual([
			"example.com",
		])
		expect(await operatorValues({ userId, key: "author", q: "" })).toEqual([])
	})
})

describe("keepsArchived", () => {
	it("holds when the results are the library and the archive together", () => {
		expect(keepsArchived("quokka")).toBe(true)
		expect(keepsArchived("quokka in:anywhere")).toBe(true)
		expect(keepsArchived("quokka in:library in:archive")).toBe(true)
		expect(keepsArchived("quokka -in:trash")).toBe(true)
		expect(keepsArchived("quokka is:starred")).toBe(true)
	})

	it("does not when archiving or unarchiving takes an article out", () => {
		expect(keepsArchived("quokka in:library")).toBe(false)
		expect(keepsArchived("quokka in:archive")).toBe(false)
		expect(keepsArchived("quokka in:trash")).toBe(false)
		expect(keepsArchived("quokka -in:archive")).toBe(false)
		expect(keepsArchived("quokka in:anywhere -in:library")).toBe(false)
	})
})
