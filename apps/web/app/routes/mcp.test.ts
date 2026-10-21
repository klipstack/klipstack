import { BATCH_MAX } from "@klipstack/api-contract"
import { db, eq, highlights, newId, user, userFeatures } from "@klipstack/db"
import { stopBoss } from "@klipstack/queue"
import type { Client } from "@modelcontextprotocol/client"
import sharp from "sharp"
import { afterAll, describe, expect, it, vi } from "vitest"
import { askAboutPassage, briefArticle } from "~/commands/ai.server"
import { openArticle } from "~/commands/articles.server"
import { createSavedSearch } from "~/commands/saved-searches.server"
import { env } from "~/lib/env.server"
import { usageOf } from "~/lib/limits.server"
import { createHighlight } from "~/services/highlights.server"
import { countBacklinks } from "~/services/links.server"
import { apiUsers, captured, FIXTURES, mcpClient } from "~/test/api-harness"
import { insertArticle, seedFeeds, storeImage } from "../../e2e/seed"
import { action } from "./mcp"

/**
 * MCP at /mcp with an API key, through the MCP client, answered in this process by the real route
 * and database. OAuth tokens, and discovery through /.well-known, stay in e2e/mcp.spec.ts.
 */

// The fake model, as on a server with a provider set up.
vi.hoisted(() => {
	process.env.AI_FAKE = "1"
})

const origin = new URL(env.APP_URL).origin
const en = { language: "en" as const }
const JOEL = FIXTURES.joel
const JOEL_URL = JOEL.url.replace(/\/$/, "")
const QUOTE = "Do you use source control?"
const MISSING = "00000000-0000-4000-8000-000000000000"

const READ_TOOLS = [
	"get_ai_history",
	"get_article",
	"list_feed",
	"list_article_links",
	"list_note_links",
	"list_article_notes",
	"list_highlights",
	"list_library",
	"list_saved_searches",
	"list_tags",
	"list_topics",
	"search_library",
	"view_images",
]
const WRITE_TOOLS = [
	"add_highlight",
	"create_saved_search",
	"create_tag",
	"delete_highlight",
	"delete_saved_search",
	"delete_tag",
	"dismiss_feed_items",
	"follow_feed",
	"mark_feed_viewed",
	"save_feed_items",
	"rename_saved_search",
	"rename_tag",
	"restore_articles",
	"restore_highlight",
	"save_article",
	"trash_articles",
	"update_articles",
	"unfollow_feed",
	"update_article_note",
	"update_edition_note",
	"update_highlight",
]

type TextResult = { content: { type: string; text?: string }[]; isError?: boolean }

const users = apiUsers("mcp")
const others: string[] = []
const clients: Client[] = []
afterAll(async () => {
	for (const client of clients) await client.close()
	await users.cleanup()
	for (const id of others) await db.delete(user).where(eq(user.id, id))
	await stopBoss()
})

async function connect(token: string, options?: { legacy?: boolean }) {
	const client = await mcpClient(token, options)
	clients.push(client)
	return client
}

function text(result: unknown): string {
	return (result as TextResult).content.map((c) => c.text ?? "").join("")
}

/** Calls a tool and parses its JSON result; fails the test on a tool error. */
async function call(mcp: Client, name: string, args: Record<string, unknown> = {}) {
	const result = await mcp.callTool({ name, arguments: args })
	expect((result as TextResult).isError, text(result)).toBeFalsy()
	return JSON.parse(text(result))
}

/** Calls a tool that should fail and returns its error text. */
async function callError(mcp: Client, name: string, args: Record<string, unknown>) {
	const result = await mcp.callTool({ name, arguments: args })
	expect((result as TextResult).isError).toBe(true)
	return text(result)
}

/** The "## Note" section of get_article's Markdown. */
function noteSection(markdown: string) {
	return /\n## Note\n\n([\s\S]*?)(?:\n\n## |\n?$)/.exec(markdown)?.[1] ?? ""
}

/**
 * A user with the Joel Test extracted (and the Maker's Schedule with `second`), a highlight with a
 * note on the first occurrence of a repeated question, and an MCP client over an API key.
 */
async function setupLibrary({ second = false } = {}) {
	const me = await users.create("MCP Reader")
	const joel = await captured(me.id, JOEL)
	const makers = second ? await captured(me.id, FIXTURES.makers) : ""
	const input = { exact: QUOTE, note: "We do, since forever." }
	const first = await createHighlight({ userId: me.id, documentId: joel, input })
	if (first.ok || first.error !== "ambiguous") throw new Error("expected two occurrences")
	await createHighlight({
		userId: me.id,
		documentId: joel,
		input: { ...input, ...first.candidates[0] },
	})
	return { ...me, joel, makers, mcp: await connect(me.key) }
}

describe("POST /mcp", () => {
	it("answers a caller without a token before reading the body", async () => {
		// A body that never arrives: reading it would hold one of the reads every form shares.
		const body = new ReadableStream<Uint8Array>({ start() {} })
		const request = new Request("http://localhost:5180/mcp", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body,
			duplex: "half",
		} as RequestInit)
		const response = await action({ request } as Parameters<typeof action>[0])
		expect(response.status).toBe(401)
	})
})

describe("MCP with an API key", () => {
	it("reads the library through the read-only tools", { timeout: 30_000 }, async () => {
		const { id: owner, key, joel, mcp } = await setupLibrary()

		const { tools } = await mcp.listTools()
		expect(tools.map((t) => t.name).sort()).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort())
		for (const tool of tools)
			expect(tool.annotations?.readOnlyHint).toBe(READ_TOOLS.includes(tool.name))
		for (const name of ["trash_articles", "delete_highlight", "unfollow_feed"])
			expect(tools.find((t) => t.name === name)?.annotations?.destructiveHint).toBe(true)
		expect(mcp.getInstructions()).toContain("untrusted")

		const search = await call(mcp, "search_library", { query: "source control" })
		expect(search.items[0]).toMatchObject({ id: joel, title: JOEL.title, location: "inbox" })

		const list = await call(mcp, "list_library")
		expect(list.items.map((i: { id: string }) => i.id)).toEqual([joel])
		expect(list.nextCursor).toBeNull()
		expect(list.items[0]).toMatchObject({
			opened: false,
			progress: 0,
			finished: false,
			description: expect.any(String),
		})

		// The app's list filters and sorts.
		const ids = async (args: Record<string, unknown>) =>
			(await call(mcp, "list_library", args)).items.map((i: { id: string }) => i.id)
		expect(await ids({ filter: "unread" })).toEqual([joel])
		expect(await ids({ filter: "progress" })).toEqual([])
		expect(await ids({ filter: "long", sort: "shortest" })).toEqual([])
		await openArticle(owner, joel)
		expect(await ids({ filter: "unread" })).toEqual([])
		expect(await ids({ filter: "progress" })).toEqual([joel])
		expect((await call(mcp, "list_library")).items[0].opened).toBe(true)
		expect(await ids({ view: "archive", filter: "unfinished" })).toEqual([])
		expect(await callError(mcp, "list_library", { view: "archive", filter: "unread" })).toContain(
			"Archive, starred and all filters: unfinished, finished, quick, long, x",
		)

		const article = text(await mcp.callTool({ name: "get_article", arguments: { id: joel } }))
		expect(article).toContain(`# ${JOEL.title}`)
		expect(article).toContain("## Highlights")
		expect(article).toContain(`> ${QUOTE}`)
		expect(article).toContain("We do, since forever.")
		const part = text(
			await mcp.callTool({ name: "get_article", arguments: { id: joel, offset: 100 } }),
		)
		expect(part).toMatch(/\[Characters 100–\d+ of \d+\.\]$/)
		expect(await callError(mcp, "get_article", { id: MISSING })).toContain("No article")

		const found = await call(mcp, "list_highlights", { query: "source" })
		expect(found.items).toHaveLength(1)
		expect(found.items[0]).toMatchObject({
			quote: QUOTE,
			note: "We do, since forever.",
			color: "yellow",
			article: { id: joel, title: JOEL.title },
		})

		// 2025-era clients are served statelessly with the same tools.
		const legacy = await connect(key, { legacy: true })
		expect((await legacy.listTools()).tools).toHaveLength(READ_TOOLS.length + WRITE_TOOLS.length)
	})

	it("changes the library through the write tools", { timeout: 30_000 }, async () => {
		const { id: owner, joel: id, makers: other, mcp } = await setupLibrary({ second: true })

		// Article state, one or many at a time
		expect(
			await call(mcp, "update_articles", { ids: [id], starred: true, title: "Joel's test" }),
		).toEqual({
			items: [
				expect.objectContaining({ id, title: "Joel's test", starred: true, location: "inbox" }),
			],
			notFound: [],
		})
		expect((await call(mcp, "list_library", { view: "starred" })).items[0].id).toBe(id)
		expect(await call(mcp, "update_articles", { ids: [id], shortlisted: true })).toEqual({
			items: [expect.objectContaining({ id, shortlisted: true })],
			notFound: [],
		})
		const finished = await call(mcp, "update_articles", {
			ids: [id, other, id, MISSING],
			finished: true,
		})
		expect(finished.items).toEqual([
			expect.objectContaining({
				id,
				location: "archive",
				finished: true,
				archivedAt: expect.any(String),
				finishedAt: expect.any(String),
			}),
			expect.objectContaining({ id: other, location: "archive", finished: true }),
		])
		expect(finished.notFound).toEqual([MISSING])
		expect((await call(mcp, "list_library", { view: "archive" })).items).toHaveLength(2)
		// Ids in upper case name the same articles.
		const back = await call(mcp, "update_articles", {
			ids: [id.toUpperCase(), other],
			location: "inbox",
		})
		expect(back.notFound).toEqual([])
		expect(
			back.items.map((i: { id: string; location: string; finished: boolean }) => [
				i.id,
				i.location,
				i.finished,
			]),
		).toEqual([
			[id, "inbox", false],
			[other, "inbox", false],
		])
		// Tags: added to many at once, listed with their counts, and a way to search.
		const tagged = await call(mcp, "update_articles", { ids: [id, other], addTags: ["To Review"] })
		expect(tagged.items.map((i: { tags: string[] }) => i.tags)).toEqual([
			["To Review"],
			["To Review"],
		])
		await call(mcp, "update_articles", { ids: [other], removeTags: ["to review"] })
		expect((await call(mcp, "list_tags")).items).toEqual([{ name: "To Review", articles: 1 }])
		const byTag = await call(mcp, "search_library", { query: 'tag:"to review"' })
		expect(byTag.items.map((i: { id: string }) => i.id)).toEqual([id])
		// The tags themselves, by name: made ahead of their articles, renamed, merged and deleted.
		expect(await call(mcp, "create_tag", { name: " Deep  Dives " })).toEqual({
			name: "Deep Dives",
			articles: 0,
			created: true,
		})
		expect(await call(mcp, "create_tag", { name: "deep dives" })).toMatchObject({ created: false })
		expect(await call(mcp, "rename_tag", { name: "DEEP DIVES", new_name: "Long Reads" })).toEqual({
			name: "Long Reads",
			articles: 0,
			merged: false,
		})
		// A saved search names the tag; its query follows the tag through the merge below.
		expect((await call(mcp, "list_saved_searches")).items).toEqual([])
		await createSavedSearch(owner, { name: "Weekend", query: 'tag:"long reads" is:unread' })
		// Onto another tag's name: the two merge, and the articles go with them.
		await call(mcp, "update_articles", { ids: [other], addTags: ["Long Reads"] })
		expect(await call(mcp, "rename_tag", { name: "long reads", new_name: "to review" })).toEqual({
			name: "To Review",
			articles: 2,
			merged: true,
		})
		expect((await call(mcp, "list_tags")).items).toEqual([{ name: "To Review", articles: 2 }])
		expect((await call(mcp, "list_saved_searches")).items).toEqual([
			{ name: "Weekend", query: 'tag:"To Review" is:unread' },
		])
		expect(await callError(mcp, "rename_tag", { name: "Long Reads", new_name: "x" })).toContain(
			"no tag with that name",
		)
		// A tag a saved search names stays until the user agrees: the error names the search.
		const refused = await callError(mcp, "delete_tag", { name: "TO REVIEW" })
		expect(refused).toContain('- Weekend: tag:"To Review" is:unread')
		expect(refused).toContain("force: true")
		expect((await call(mcp, "list_tags")).items).toEqual([{ name: "To Review", articles: 2 }])
		expect(await call(mcp, "delete_tag", { name: "TO REVIEW", force: true })).toEqual({
			name: "To Review",
			deleted: true,
			articlesUntagged: 2,
		})
		expect((await call(mcp, "list_tags")).items).toEqual([])
		// The saved search stays as it was, and finds nothing.
		expect((await call(mcp, "list_saved_searches")).items).toEqual([
			{ name: "Weekend", query: 'tag:"To Review" is:unread' },
		])
		expect(await callError(mcp, "delete_tag", { name: "To Review" })).toContain("no tag")
		// Saved searches, by name: made, renamed and deleted.
		expect(
			await call(mcp, "create_saved_search", { name: " Quick  wins ", query: "is:unread" }),
		).toEqual({ name: "Quick wins", query: "is:unread" })
		expect(await callError(mcp, "create_saved_search", { name: "WEEKEND", query: "x" })).toContain(
			"Another saved search has that name",
		)
		expect(
			await call(mcp, "rename_saved_search", { name: "weekend", new_name: "Saturday" }),
		).toEqual({ name: "Saturday", query: 'tag:"To Review" is:unread' })
		expect(
			await callError(mcp, "rename_saved_search", { name: "saturday", new_name: "quick wins" }),
		).toContain("Another saved search has that name")
		expect(await call(mcp, "delete_saved_search", { name: "QUICK WINS" })).toEqual({
			name: "Quick wins",
			deleted: true,
		})
		expect((await call(mcp, "list_saved_searches")).items).toEqual([
			{ name: "Saturday", query: 'tag:"To Review" is:unread' },
		])
		for (const name of ["rename_saved_search", "delete_saved_search"])
			expect(await callError(mcp, name, { name: "Quick wins", new_name: "Other" })).toContain(
				"no saved search with that name",
			)
		// The articles are still there, without the tag.
		const bare = await call(mcp, "search_library", { query: "-has:tags" })
		expect(bare.items.map((i: { id: string }) => i.id).sort()).toEqual([id, other].sort())
		for (const args of [
			{ ids: [id], finished: true, location: "inbox" },
			{ ids: [id] },
			{ ids: [id], addTags: ["a,b"] },
			{ ids: [id, other], title: "Same title" },
			{ ids: [] },
			{ ids: Array.from({ length: BATCH_MAX + 1 }, () => crypto.randomUUID()), starred: true },
		])
			await expect(
				mcp.callTool({ name: "update_articles", arguments: args }),
			).resolves.toMatchObject({ isError: true })
		// Ids not in the library are reported, as the API reports them.
		expect(await call(mcp, "update_articles", { ids: [MISSING], starred: true })).toEqual({
			items: [],
			notFound: [MISSING],
		})

		// The article note: append keeps what the user wrote.
		await call(mcp, "update_article_note", { id, text: "Mine.", mode: "replace" })
		expect(
			await call(mcp, "update_article_note", { id, text: "From the assistant." }),
		).toMatchObject({ note: "Mine.\n\nFrom the assistant." })

		// The note for the next edition: replaced, apart from the note, and shown by get_article.
		expect(await call(mcp, "update_edition_note", { id, text: "For my readers." })).toEqual({
			id,
			editionNote: "For my readers.",
		})
		const read = text(await mcp.callTool({ name: "get_article", arguments: { id } }))
		expect(read).toContain("## Note for my next edition\n\nFor my readers.")
		expect(await call(mcp, "update_edition_note", { id, text: "" })).toEqual({
			id,
			editionNote: null,
		})

		// Highlights: a repeated passage needs an occurrence; Markdown in the quote is tolerated.
		const repeated = await callError(mcp, "add_highlight", { article_id: id, quote: QUOTE })
		expect(repeated).toContain("appears 2 times")
		expect(repeated).toMatch(/^1\. ….*\[Do you use source control\?\]/m)
		const second = await call(mcp, "add_highlight", {
			article_id: id,
			quote: QUOTE,
			occurrence: 2,
			note: "The second one",
			color: "green",
		})
		expect(second).toMatchObject({ quote: QUOTE, note: "The second one", color: "green" })
		const linked = await call(mcp, "add_highlight", {
			article_id: id,
			quote: "Have you ever heard of [SEMA](http://www.sei.cmu.edu/sema/welcome.html)?",
		})
		expect(linked.quote).toBe("Have you ever heard of SEMA?")
		expect(
			await callError(mcp, "add_highlight", {
				article_id: id,
				quote: "Not in this article at all",
			}),
		).toContain("not in the article")

		expect((await call(mcp, "list_highlights", { article_id: id })).items).toHaveLength(3)
		expect(
			await call(mcp, "update_highlight", { id: second.id, note: null, color: "pink" }),
		).toMatchObject({ note: null, color: "pink" })
		expect(await call(mcp, "delete_highlight", { id: second.id })).toEqual({
			id: second.id,
			deleted: true,
		})
		expect((await call(mcp, "list_highlights", { article_id: id })).items).toHaveLength(2)
		expect(await callError(mcp, "update_highlight", { id: second.id, color: "blue" })).toContain(
			"No highlight",
		)
		// A deleted highlight comes back, note and color included.
		expect(await call(mcp, "restore_highlight", { id: second.id })).toEqual({
			id: second.id,
			restored: true,
		})
		expect(
			(await call(mcp, "list_highlights", { article_id: id })).items.find(
				(h: { id: string }) => h.id === second.id,
			),
		).toMatchObject({ quote: QUOTE, color: "pink" })
		expect(await callError(mcp, "restore_highlight", { id: MISSING })).toContain("No highlight")
		await call(mcp, "delete_highlight", { id: second.id })
		const article = text(await mcp.callTool({ name: "get_article", arguments: { id } }))
		expect(article).toContain("From the assistant.")
		expect(article).toContain("> Have you ever heard of SEMA?")

		// Saving: an article already in the library comes back as is; bad URLs are refused.
		expect(await call(mcp, "save_article", { url: JOEL.url })).toMatchObject({
			id,
			created: false,
		})
		expect(await callError(mcp, "save_article", { url: "not a url" })).toContain("not a valid")

		// Trash
		expect(await call(mcp, "trash_articles", { ids: [id, other, MISSING] })).toEqual({
			trashed: [id, other],
			notFound: [MISSING],
			restorableForDays: 30,
		})
		expect((await call(mcp, "list_library")).items).toEqual([])
		expect(await callError(mcp, "get_article", { id })).toContain("No article")
		// Trashed articles are not in the library: batches report them, as the API does.
		expect(await call(mcp, "update_articles", { ids: [id], starred: false })).toEqual({
			items: [],
			notFound: [id],
		})
		expect(await call(mcp, "trash_articles", { ids: [id] })).toMatchObject({
			trashed: [],
			notFound: [id],
		})

		// The trash lists them, with when they went there and where they would go back to.
		const trash = await call(mcp, "list_library", { view: "trash" })
		expect(trash.items.map((i: { id: string }) => i.id).sort()).toEqual([id, other].sort())
		expect(trash.items[0]).toMatchObject({ location: "inbox", trashedAt: expect.any(String) })
		expect(await callError(mcp, "list_library", { view: "trash", filter: "unread" })).toContain(
			"The trash takes none",
		)
		// Restored, with its highlights; ids not in the trash are reported.
		expect(await call(mcp, "restore_articles", { ids: [id, MISSING] })).toEqual({
			restored: [id],
			notFound: [MISSING],
			alreadySaved: [],
		})
		expect((await call(mcp, "list_library")).items).toEqual([
			expect.not.objectContaining({ trashedAt: expect.anything() }),
		])
		expect((await call(mcp, "list_highlights", { article_id: id })).items).toHaveLength(2)
		expect(await call(mcp, "restore_articles", { ids: [id] })).toMatchObject({
			restored: [],
			notFound: [id],
		})
		// The same page saved again since: that article stays, and the trashed one is named.
		const again = await call(mcp, "save_article", { url: FIXTURES.makers.url })
		expect(again).toMatchObject({ created: true })
		expect(await call(mcp, "restore_articles", { ids: [other] })).toEqual({
			restored: [],
			notFound: [],
			alreadySaved: [{ id: other, articleId: again.id }],
		})
	})

	it(
		"writes notes that link articles, also when copied back from get_article",
		{ timeout: 30_000 },
		async () => {
			const { id: owner, joel, makers, mcp } = await setupLibrary({ second: true })
			const backlinks = (id: string) => countBacklinks(owner, id)
			expect(
				(await mcp.listTools()).tools.find((t) => t.name === "update_article_note")?.description,
			).toContain(`[Title](${origin}/read/<article id>)`)
			for (const name of ["update_article_note", "add_highlight", "update_highlight"]) {
				const tool = (await mcp.listTools()).tools.find((t) => t.name === name)
				expect(tool?.description).toContain("[Title](/read/<article id>)")
			}

			// A link written with the full reader URL becomes a link between the articles.
			const link = `[Maker's Schedule](${origin}/read/${makers})`
			expect(
				await call(mcp, "update_article_note", { id: joel, text: `Compare ${link}.` }),
			).toMatchObject({ id: joel, note: `Compare [Maker's Schedule](/read/${makers}).` })
			expect(await backlinks(makers)).toBe(1)

			// get_article shows full URLs; replacing the note with that text keeps the link.
			const shown = noteSection(
				text(await mcp.callTool({ name: "get_article", arguments: { id: joel } })),
			)
			expect(shown).toBe(`Compare ${link}.`)
			await call(mcp, "update_article_note", {
				id: joel,
				text: `${shown} Still true.`,
				mode: "replace",
			})
			expect(await backlinks(makers)).toBe(1)

			// Highlight notes too.
			const listed = await call(mcp, "list_highlights", { article_id: joel })
			await call(mcp, "update_highlight", { id: listed.items[0].id, note: `See ${link}` })
			expect(await backlinks(makers)).toBe(2)
			const added = await call(mcp, "add_highlight", {
				article_id: makers,
				quote: "There are two types of schedule",
				note: `Opposite of [the Joel Test](${origin}/read/${joel})`,
			})
			expect(added.note).toBe(`Opposite of [the Joel Test](/read/${joel})`)
			expect(await backlinks(joel)).toBe(1)

			// Both directions, as a light tool and in get_article.
			const makersLinks = await call(mcp, "list_article_links", { article_id: makers })
			expect(makersLinks.noteLinks.from).toEqual([
				{
					id: joel,
					title: JOEL.title,
					url: JOEL_URL,
					klipstackUrl: `${origin}/read/${joel}`,
					highlight: { id: listed.items[0].id, quote: QUOTE },
				},
				expect.objectContaining({ id: joel, highlight: null }),
			])
			expect(makersLinks.noteLinks.to).toEqual([
				{
					id: joel,
					title: "the Joel Test",
					status: "ok",
					klipstackUrl: `${origin}/read/${joel}`,
					highlight: { id: added.id, quote: "There are two types of schedule" },
				},
			])
			const joelArticle = text(await mcp.callTool({ name: "get_article", arguments: { id: joel } }))
			expect(joelArticle).toContain(
				`## Note links to\n\n- [Maker's Schedule](${origin}/read/${makers}), from the note\n- [Maker's Schedule](${origin}/read/${makers}), from a highlight: “${QUOTE}”`,
			)
			expect(joelArticle).toContain(
				`## Note links from\n\n- [Maker's Schedule, Manager's Schedule](${origin}/read/${makers}), in a highlight: “There are two types of schedule”`,
			)
			const connections = await call(mcp, "list_note_links", { limit: 2 })
			expect(connections.items).toHaveLength(2)
			expect(connections.items[0]).toMatchObject({
				source: { id: makers, klipstackUrl: `${origin}/read/${makers}` },
				target: { id: joel, klipstackUrl: `${origin}/read/${joel}` },
				highlight: { id: added.id },
			})
			const remaining = await call(mcp, "list_note_links", {
				limit: 2,
				cursor: connections.nextCursor,
			})
			expect(remaining.items).toHaveLength(1)
			expect(remaining.nextCursor).toBeNull()
			expect((await call(mcp, "list_library", { has_note_links: true })).items).toHaveLength(2)
			expect((await call(mcp, "list_library", { has_note_links: false })).items).toEqual([])

			// A trashed target stays listed, marked; its own links no longer count as backlinks.
			await call(mcp, "trash_articles", { ids: [makers] })
			const afterTrash = await call(mcp, "list_article_links", { article_id: joel })
			expect(afterTrash.noteLinks.to.map((l: { status: string }) => l.status)).toEqual([
				"trash",
				"trash",
			])
			expect(afterTrash.noteLinks.from).toEqual([])
			expect(text(await mcp.callTool({ name: "get_article", arguments: { id: joel } }))).toContain(
				`(${origin}/read/${makers}) (in the trash), from the note`,
			)
			expect(await callError(mcp, "list_article_links", { article_id: makers })).toContain(
				"No article",
			)
			expect((await call(mcp, "list_note_links")).items).toEqual([])
			expect((await call(mcp, "list_library", { has_note_links: true })).items).toEqual([])
		},
	)

	it("shows links in an article's content apart from note links", { timeout: 30_000 }, async () => {
		const { id: owner, joel, mcp } = await setupLibrary()
		const paragraph =
			"This paragraph exists so the extractor keeps the article. It says nothing of interest, but it is long enough to count as content, and it repeats that idea a few more times for good measure. "
		const linky = await captured(owner, {
			url: "https://example.com/linky",
			html: `<!DOCTYPE html><html><head><title>Linky</title></head><body><article><h1>Linky</h1>
				<p>${paragraph}</p><p>Read <a href="${JOEL.url}?utm_source=linky">the Joel Test</a> first.</p>
				<p>${paragraph}</p><p>${paragraph}</p><p>${paragraph}</p></article></body></html>`,
		})

		const joelRef = {
			id: joel,
			title: JOEL.title,
			url: JOEL_URL,
			klipstackUrl: `${origin}/read/${joel}`,
		}
		const linkyRef = {
			id: linky,
			title: "Linky",
			url: "https://example.com/linky",
			klipstackUrl: `${origin}/read/${linky}`,
		}
		expect(await call(mcp, "list_article_links", { article_id: linky })).toEqual({
			noteLinks: { to: [], from: [] },
			contentLinks: { to: [joelRef], from: [] },
		})
		expect(await call(mcp, "list_article_links", { article_id: joel })).toEqual({
			noteLinks: { to: [], from: [] },
			contentLinks: { to: [], from: [linkyRef] },
		})
		expect(text(await mcp.callTool({ name: "get_article", arguments: { id: linky } }))).toContain(
			`## Content links to\n\n- [${JOEL.title}](${origin}/read/${joel})`,
		)
		const joelArticle = text(await mcp.callTool({ name: "get_article", arguments: { id: joel } }))
		expect(joelArticle).toContain(`## Content links from\n\n- [Linky](${origin}/read/${linky})`)
		expect(joelArticle).not.toContain("## Note links")

		// The author's link is not the user's: the note link tools leave it out.
		expect((await call(mcp, "list_note_links")).items).toEqual([])
		expect((await call(mcp, "list_library", { has_note_links: true })).items).toEqual([])
	})

	it("searches article notes and finds annotations changed in a date window", async () => {
		const me = await users.create("Annotation reader")
		const first = await insertArticle(me.id, "First article", "<p>First article</p>")
		const second = await insertArticle(me.id, "Second article", "<p>Second article</p>")
		const mcp = await connect(me.key)
		const saved = await call(mcp, "update_article_note", {
			id: first,
			text: `orbital compass [Related](/read/${second})`,
		})
		expect(saved.updatedAt).toEqual(expect.any(String))
		expect(
			(await call(mcp, "search_library", { query: '"orbital compass"' })).items.map(
				(i: { id: string }) => i.id,
			),
		).toEqual([first])
		const notes = await call(mcp, "list_article_notes", {
			query: "orbital",
			updated_since: saved.updatedAt,
		})
		expect(notes.items).toHaveLength(1)
		expect(notes.items[0]).toMatchObject({ id: first, note: saved.note, article: { id: first } })
		expect(Date.parse(notes.items[0].updatedAt)).toBe(Date.parse(saved.updatedAt))
		expect(
			(await call(mcp, "list_article_notes", { updated_before: saved.updatedAt })).items,
		).toEqual([])
		const cleared = await call(mcp, "update_article_note", {
			id: second,
			text: "",
			mode: "replace",
		})
		const firstPage = await call(mcp, "list_article_notes", { limit: 1 })
		expect(firstPage.items[0]).toMatchObject({ id: second, note: null })
		const nextPage = await call(mcp, "list_article_notes", {
			limit: 1,
			cursor: firstPage.nextCursor,
		})
		expect(nextPage.items[0].id).toBe(first)
		expect(nextPage.nextCursor).toBeNull()
		expect(
			(await call(mcp, "list_article_notes", { updated_since: cleared.updatedAt })).items[0].note,
		).toBeNull()

		const h = await call(mcp, "add_highlight", { article_id: first, quote: "First article" })
		await db
			.update(highlights)
			.set({
				createdAt: new Date("2020-01-01T00:00:00Z"),
				updatedAt: new Date("2020-01-01T00:00:00Z"),
			})
			.where(eq(highlights.id, h.id))
		const edited = await call(mcp, "update_highlight", { id: h.id, note: "new insight" })
		const changed = await call(mcp, "list_highlights", { updated_since: saved.updatedAt })
		expect(changed.items).toHaveLength(1)
		expect(changed.items[0]).toMatchObject({
			id: h.id,
			note: "new insight",
			updatedAt: edited.updatedAt,
			createdAt: "2020-01-01T00:00:00.000Z",
		})
		expect((await call(mcp, "list_highlights", { created_since: saved.updatedAt })).items).toEqual(
			[],
		)
		expect(
			(await call(mcp, "list_highlights", { updated_before: edited.updatedAt })).items,
		).toEqual([])
		for (const name of ["list_highlights", "list_article_notes"]) {
			expect(await callError(mcp, name, { updated_since: "last week" })).toContain("Invalid")
			expect(
				await callError(mcp, name, {
					updated_since: "2026-09-12T00:00:00Z",
					updated_before: "2026-09-10T00:00:00Z",
				}),
			).toContain("must not be after")
			expect(await callError(mcp, name, { cursor: "invalid" })).toContain("Invalid cursor")
		}
	})

	it("refuses tool arguments with more elements than any tool takes, before validating them", async () => {
		const me = await users.create("MCP Big Input")
		const mcp = await connect(me.key)
		// Each element costs memory to validate: a 1 MiB body holds a few hundred thousand of them.
		const error = await callError(mcp, "update_articles", {
			ids: Array.from({ length: 1001 }, () => MISSING),
			starred: true,
		})
		expect(error).toContain("more than the maximum of 1000 elements")
		// The largest call a tool takes still goes through.
		expect(
			await call(mcp, "update_articles", {
				ids: Array.from({ length: BATCH_MAX }, () => MISSING),
				addTags: ["a", "b"],
				starred: true,
			}),
		).toEqual({ items: [], notFound: [MISSING] })
	})

	it("reads an article's AI answers and brief, and never asks for one", async () => {
		const { id: owner, joel, makers, mcp } = await setupLibrary({ second: true })
		expect(await callError(mcp, "get_ai_history", { article_id: joel })).toContain(
			"AI answers are not turned on",
		)
		await db.insert(userFeatures).values({ userId: owner, feature: "ai" })

		const asked = await askAboutPassage(
			owner,
			joel,
			{ action: "define", exact: "Have you ever heard of SEMA?" },
			en,
		)
		for await (const _ of asked.events);
		const answer = await asked.answer
		const brief = await briefArticle(owner, joel, en)
		if (!("events" in brief)) throw new Error("expected a new brief")
		for await (const _ of brief.events);
		const kept = await brief.brief

		const history = await call(mcp, "get_ai_history", { article_id: joel })
		expect(history).toEqual({
			brief: {
				text: kept!.text,
				citations: kept!.citations.map((c) => c.exact),
				createdAt: expect.any(String),
			},
			threads: [
				{
					id: asked.thread.id,
					action: "define",
					passage: "Have you ever heard of SEMA?",
					highlightId: null,
					orphaned: false,
					createdAt: expect.any(String),
					messages: [
						{
							role: "user",
							text: "",
							status: "done",
							citations: [],
							createdAt: expect.any(String),
						},
						{
							role: "assistant",
							text: answer.text,
							status: "done",
							citations: answer.citations.map((c) => c.exact),
							createdAt: expect.any(String),
						},
					],
				},
			],
		})
		expect(answer.citations.length).toBeGreaterThan(0)

		// An article without a brief stays without one: reading costs nothing.
		const used = (await usageOf(owner)).ai.used
		expect(await call(mcp, "get_ai_history", { article_id: makers })).toEqual({
			brief: null,
			threads: [],
		})
		expect((await usageOf(owner)).ai.used).toBe(used)
		expect(await callError(mcp, "get_ai_history", { article_id: MISSING })).toContain("No article")
	})

	it("refuses the feed tools while feeds are turned off", async () => {
		const me = await users.create("MCP Feeds Off", {})
		const mcp = await connect(me.key)
		for (const name of ["list_feed", "mark_feed_viewed"])
			expect(
				await callError(mcp, name, name === "list_feed" ? {} : { as_of: new Date().toISOString() }),
			).toContain("Feeds are turned off for this account.")
	})

	it("goes through the feed: list, save, dismiss, mark viewed, follow, unfollow", async () => {
		const me = await users.create("MCP Feeds")
		const { otherUrl } = await seedFeeds(me.email)
		const mcp = await connect(me.key)

		const listed = await call(mcp, "list_feed")
		expect(listed.feeds).toHaveLength(1)
		const busy = listed.feeds[0]
		expect(busy).toMatchObject({
			title: "Busy blog",
			newCount: 3,
			notUpdating: false,
			moreItems: 0,
		})
		expect(busy.items.map((i: { title: string }) => i.title)).toEqual([
			"Busy post 3",
			"Busy post 2",
			"Busy post 1",
		])
		expect(busy.items[0]).toMatchObject({ author: "Ann", new: true, savedArticleId: null })
		expect(listed.quietFeeds).toEqual([
			expect.objectContaining({ title: "Quiet blog", notUpdating: true }),
		])
		const [post3, post2, post1] = busy.items.map((i: { id: string }) => i.id)
		const short = await call(mcp, "list_feed", { items_per_feed: 2, feed_id: busy.id })
		expect(short.feeds[0].items).toHaveLength(2)
		expect(short.feeds[0].moreItems).toBe(1)
		expect(short.quietFeeds).toEqual([])

		// Save one, dismiss one.
		const saved = await call(mcp, "save_feed_items", { ids: [post3, MISSING] })
		expect(saved.saved).toEqual([
			expect.objectContaining({ itemId: post3, articleId: expect.any(String) }),
		])
		expect(saved.notFound).toEqual([MISSING])
		expect(saved.notSaved).toEqual([])
		expect(await call(mcp, "dismiss_feed_items", { ids: [post2, MISSING] })).toEqual({
			dismissed: [post2],
			notFound: [MISSING],
		})
		const after = (await call(mcp, "list_feed")).feeds[0]
		expect(after.items.map((i: { id: string }) => i.id)).toEqual([post3, post1])
		expect(after.items[0].savedArticleId).toBe(saved.saved[0].articleId)
		expect(after.newCount).toBe(1)
		const newOnly = await call(mcp, "list_feed", { new_only: true })
		expect(newOnly.feeds[0].items.map((i: { id: string }) => i.id)).toEqual([post1])

		// Mark viewed as of the listing: nothing is new any more; a future time is clamped.
		expect(await call(mcp, "mark_feed_viewed", { as_of: newOnly.listedAt })).toEqual({
			viewedAt: newOnly.listedAt,
		})
		expect((await call(mcp, "list_feed", { new_only: true })).feeds).toEqual([])
		expect((await call(mcp, "list_feed")).feeds[0].items[1]).toMatchObject({
			id: post1,
			new: false,
		})
		const future = await call(mcp, "mark_feed_viewed", { as_of: "2100-01-01T00:00:00Z" })
		expect(new Date(future.viewedAt).getTime()).toBeLessThanOrEqual(Date.now())

		// Follow a known feed (no fetch), and unfollow it.
		const followed = await call(mcp, "follow_feed", { url: otherUrl })
		expect(followed).toMatchObject({
			followed: true,
			feed: { title: "Other blog" },
			alreadyFollowing: false,
		})
		expect(await call(mcp, "follow_feed", { url: otherUrl })).toMatchObject({
			alreadyFollowing: true,
		})
		expect(await callError(mcp, "follow_feed", { url: "not a url" })).toContain("not a valid")
		expect(
			(await call(mcp, "list_feed")).quietFeeds.map((f: { title: string }) => f.title),
		).toEqual(["Other blog", "Quiet blog"])
		expect(await call(mcp, "unfollow_feed", { feed_id: followed.feed.id })).toEqual({
			id: followed.feed.id,
			unfollowed: true,
		})
		expect(await callError(mcp, "unfollow_feed", { feed_id: followed.feed.id })).toContain(
			"No followed feed",
		)
	})

	it("numbers stored images in get_article, and view_images shows them", async () => {
		const me = await users.create("MCP Images")
		// Stored the way the worker would store them.
		const wide = await storeImage(me.id, 2000, 1000, "#c00")
		const small = await storeImage(me.id, 64, 64, "#00c")
		const articleId = await insertArticle(
			me.id,
			"Colors",
			`<p>A post about colors.</p><figure><img src="/assets/${wide.id}" data-original-src="https://example.com/red.png" alt="A red band"><figcaption>Figure 1: red</figcaption></figure><p>More <img src="https://example.com/remote.png" alt="Remote"> text.</p><p><img src="/assets/${small.id}" alt="A blue square"></p>`,
		)
		const mcp = await connect(me.key)

		const markdown = text(await mcp.callTool({ name: "get_article", arguments: { id: articleId } }))
		expect(markdown).toContain(`![Image 1: A red band](${origin}/assets/${wide.id})`)
		expect(markdown).toContain(`![Image 2: A blue square](${origin}/assets/${small.id})`)
		expect(markdown).toContain("![Remote](https://example.com/remote.png)")
		expect(markdown).not.toContain("red.png")
		expect(markdown).toContain(
			"## Images\n\nKlipstack keeps copies of these images, numbered as in the text",
		)
		expect(markdown).toContain("1. A red band — caption: Figure 1: red (2000×1000)")
		expect(markdown).toContain("2. A blue square (64×64)")
		expect(markdown).toContain("1 other image links to the original site")

		type Content = {
			type: string
			text?: string
			data?: string
			mimeType?: string
			annotations?: { audience?: string[] }
		}
		const viewed = await mcp.callTool({
			name: "view_images",
			arguments: { article_id: articleId, images: [2, 1, 9, 2] },
		})
		expect((viewed as TextResult).isError).toBeFalsy()
		const content = (viewed as { content: Content[] }).content
		expect(content.map((c) => c.type)).toEqual(["text", "image", "text", "image", "text"])
		// Small enough: the stored file as is.
		expect(content[0]!.text).toBe("Image 2: A blue square (64×64)")
		expect(content[1]).toMatchObject({
			mimeType: "image/webp",
			annotations: { audience: ["assistant", "user"] },
		})
		expect(content[1]!.data).toBe(small.data.toString("base64"))
		// Too large for a model: downscaled, aspect ratio kept.
		const sent = await sharp(Buffer.from(content[3]!.data!, "base64")).metadata()
		expect(Math.max(sent.width, sent.height)).toBeLessThanOrEqual(1568)
		expect(sent.width * sent.height).toBeLessThanOrEqual(1_150_000)
		expect(sent.width / sent.height).toBeCloseTo(2, 1)
		expect(content[2]!.text).toBe(
			`Image 1: A red band — caption: Figure 1: red (${sent.width}×${sent.height})`,
		)
		expect(content[4]!.text).toContain("Image 9: no such image; the article has 2")

		// Articles without stored copies say why view_images has nothing to show.
		const linksOnly = await insertArticle(
			me.id,
			"Remote",
			'<p>Text <img src="https://example.com/x.png"></p>',
		)
		expect(
			text(await mcp.callTool({ name: "get_article", arguments: { id: linksOnly } })),
		).toContain("1 image in the text links to the original site; Klipstack has no copy")
		expect(await callError(mcp, "view_images", { article_id: linksOnly, images: [1] })).toBe(
			"This article has no images stored in Klipstack.",
		)
		const pending = await insertArticle(me.id, "Pending", "<p>Text</p>", false)
		expect(await callError(mcp, "view_images", { article_id: pending, images: [1] })).toContain(
			"still storing",
		)
		// Another user's article is not found, and another user's image is never sent.
		const otherId = newId()
		await db
			.insert(user)
			.values({ id: otherId, name: "Other", email: `mcp-other-${otherId}@example.com` })
		others.push(otherId)
		const theirImage = await storeImage(otherId, 32, 32, "#0c0")
		const theirs = await insertArticle(otherId, "Theirs", `<p><img src="/assets/${small.id}"></p>`)
		expect(await callError(mcp, "view_images", { article_id: theirs, images: [1] })).toBe(
			"No article with that id in the library.",
		)
		const borrowed = await insertArticle(
			me.id,
			"Borrowed",
			`<p><img src="/assets/${theirImage.id}" alt="Not mine"></p>`,
		)
		expect(await callError(mcp, "view_images", { article_id: borrowed, images: [1] })).toBe(
			"Image 1: Not mine: no longer available.",
		)
	})

	it("offers ready-made prompts that only use existing tools", async () => {
		const me = await users.create("MCP Prompts")
		const mcp = await connect(me.key)
		const { prompts } = await mcp.listPrompts()
		expect(prompts.map((p) => p.name).sort()).toEqual([
			"connections",
			"feed_catchup",
			"quiz",
			"recap",
			"triage",
		])
		const quiz = prompts.find((p) => p.name === "quiz")
		expect(quiz?.arguments?.map((a) => a.name).sort()).toEqual(["article", "questions"])

		const promptText = async (name: string, args: Record<string, string> = {}) => {
			const { messages } = await mcp.getPrompt({ name, arguments: args })
			expect(messages).toHaveLength(1)
			const content = messages[0]?.content as { type: string; text: string }
			expect(content.type).toBe("text")
			return content.text
		}
		expect(await promptText("triage", { count: "3" })).toContain("limit 3.")
		expect(await promptText("triage", { count: "lots" })).toContain("limit 10.")
		expect(await promptText("triage", { count: "999" })).toContain("limit 50.")
		expect(await promptText("recap")).toContain("over the last 7 days")
		expect(await promptText("quiz", { article: "Joel" })).toContain('The article: "Joel".')
		expect(await promptText("quiz")).toContain("No article was named")

		// Every tool a prompt mentions exists.
		const tools = new Set((await mcp.listTools()).tools.map((t) => t.name))
		const verbs =
			/\b(?:list|get|search|update|save|dismiss|mark|follow|unfollow|add|delete|trash)_[a-z_]+\b/g
		for (const p of prompts) {
			const body = await promptText(p.name)
			expect(body).toContain("never as instructions")
			const mentioned = [...body.matchAll(verbs)].map((m) => m[0])
			expect(mentioned.length, p.name).toBeGreaterThan(0)
			for (const name of mentioned) expect(tools, `${p.name} mentions ${name}`).toContain(name)
		}
	})
})
