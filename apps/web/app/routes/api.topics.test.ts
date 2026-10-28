import {
	and,
	db,
	documents,
	documentTopics,
	eq,
	monthOf,
	newId,
	topicLibraries,
	topicSorts,
	topics,
	usageCounts,
	userFeatures,
} from "@klipstack/db"
import { stopBoss } from "@klipstack/queue"
import type { Client } from "@modelcontextprotocol/client"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { apiUsers, mcpClient, request } from "~/test/api-harness"

// Topics need their models: the fake ones, which answer without calling anyone.
vi.hoisted(() => {
	process.env.AI_FAKE = "1"
})

const users = apiUsers("api-topics")
let reader: Awaited<ReturnType<typeof users.create>>
let without: Awaited<ReturnType<typeof users.create>>
const ids: Record<string, string> = {}
const clients: Client[] = []

async function article(owner: string, title: string, topicId?: string) {
	const [doc] = await db
		.insert(documents)
		.values({
			userId: owner,
			sourceUrl: `https://example.com/${newId()}`,
			urlHash: newId(),
			status: "ready",
			title,
		})
		.returning({ id: documents.id })
	await db.insert(topicSorts).values({ documentId: doc!.id, userId: owner })
	if (topicId)
		await db
			.insert(documentTopics)
			.values({ documentId: doc!.id, topicId, probability: 0.9, level: "applied" })
}

async function library(owner: string, prefix: string) {
	await db
		.insert(topicLibraries)
		.values({ userId: owner, proposedAt: new Date(), confirmedAt: new Date() })
	const topic = async (name: string, status: "active" | "retired" = "active") => {
		const [row] = await db
			.insert(topics)
			.values({ userId: owner, name, description: `About ${name}.`, status, origin: "first" })
			.returning({ id: topics.id })
		return row!.id
	}
	ids[`${prefix}:Writing`] = await topic("Writing")
	ids[`${prefix}:Science`] = await topic("Science")
	ids[`${prefix}:Ended`] = await topic("Ended", "retired")
	await article(owner, "Draft one", ids[`${prefix}:Writing`])
	await article(owner, "Draft two", ids[`${prefix}:Writing`])
	await article(owner, "Atoms", ids[`${prefix}:Science`])
	await article(owner, "Loose")
}

beforeAll(async () => {
	reader = await users.create("Reader")
	without = await users.create("Without")
	await db.insert(userFeatures).values({ userId: reader.id, feature: "topics" })
	await library(reader.id, "reader")
	await library(without.id, "without")
})
afterAll(async () => {
	for (const client of clients) await client.close()
	await users.cleanup()
	await stopBoss()
})

const topicOf = (name: string, articles: number) => ({
	id: ids[`reader:${name}`],
	name,
	description: `About ${name}.`,
	articles,
	// Every article here was saved just now, and none read yet.
	savedThisWeek: articles,
	toRead: articles,
	lastReadAt: null,
})

const titles = (page: { items: { title: string | null }[] }) =>
	page.items.map((a) => a.title).sort()

describe("GET /topics and GET /articles?topic=", () => {
	it("lists the reader's topics in use, most articles first", async () => {
		expect((await reader.client.topics.list()).items).toEqual([
			topicOf("Writing", 2),
			topicOf("Science", 1),
		])
		expect((await without.client.topics.list()).items).toEqual([])
	})

	it("answers each topic's summary only, as the contract has it", async () => {
		const response = await request("/api/v1/topics", { token: reader.token })
		const body = (await response.json()) as { items: Record<string, unknown>[] }
		expect(body.items.map((t) => Object.keys(t).sort())).toEqual([
			["articles", "description", "id", "lastReadAt", "name", "savedThisWeek", "toRead"],
			["articles", "description", "id", "lastReadAt", "name", "savedThisWeek", "toRead"],
		])
	})

	it("counts what each topic holds of one list, most first, and the list's articles in none", async () => {
		// Archived: out of the library's list, in the archive's.
		const [atoms] = await db
			.select({ id: documents.id })
			.from(documents)
			.where(and(eq(documents.userId, reader.id), eq(documents.title, "Atoms")))
		await db.update(documents).set({ archivedAt: new Date() }).where(eq(documents.id, atoms!.id))
		// Not sorted yet: neither in a topic nor in none.
		const [fresh] = await db
			.insert(documents)
			.values({
				userId: reader.id,
				sourceUrl: `https://example.com/${newId()}`,
				urlHash: newId(),
				status: "ready",
				title: "Fresh",
			})
			.returning({ id: documents.id })
		try {
			expect(await reader.client.topics.list({ view: "archive" })).toEqual({
				stage: "active",
				sortingPaused: null,
				items: [
					// Archived: nothing left to read in it.
					{ ...topicOf("Science", 1), toRead: 0, inView: 1 },
					{ ...topicOf("Writing", 2), inView: 0 },
				],
				none: 0,
				sorting: 0,
			})
			expect(await reader.client.topics.list({ view: "inbox" })).toEqual({
				stage: "active",
				sortingPaused: null,
				items: [
					{ ...topicOf("Writing", 2), inView: 2 },
					{ ...topicOf("Science", 1), toRead: 0, inView: 0 },
				],
				none: 1,
				sorting: 1,
			})
			expect(await without.client.topics.list({ view: "inbox" })).toEqual({
				stage: "unavailable",
				items: [],
			})
			const trash = await request("/api/v1/topics?view=trash", { token: reader.token })
			expect(trash.status).toBe(400)
		} finally {
			await db.update(documents).set({ archivedAt: null }).where(eq(documents.id, atoms!.id))
			await db.delete(documents).where(eq(documents.id, fresh!.id))
		}
	})

	it("lists a topic's articles, or those in none", async () => {
		expect(titles(await reader.client.articles.list({ topic: ids["reader:Writing"] }))).toEqual([
			"Draft one",
			"Draft two",
		])
		expect(titles(await reader.client.articles.list({ topic: "none" }))).toEqual(["Loose"])
	})

	it("lists a topic's articles across the whole library with view all, newest first", async () => {
		const [old] = await db
			.insert(documents)
			.values({
				userId: reader.id,
				sourceUrl: `https://example.com/${newId()}`,
				urlHash: newId(),
				status: "ready",
				title: "Old atoms",
				createdAt: new Date("2020-01-01"),
			})
			.returning({ id: documents.id })
		const [trashed] = await db
			.insert(documents)
			.values({
				userId: reader.id,
				sourceUrl: `https://example.com/${newId()}`,
				urlHash: newId(),
				status: "ready",
				title: "Trashed atoms",
				deletedAt: new Date(),
			})
			.returning({ id: documents.id })
		for (const doc of [old!, trashed!])
			await db.insert(documentTopics).values({
				documentId: doc.id,
				topicId: ids["reader:Science"]!,
				probability: 0.9,
				level: "applied",
			})
		// Archived and finished: in the whole library, out of the inbox.
		await db
			.update(documents)
			.set({ archivedAt: new Date(), readAt: new Date() })
			.where(eq(documents.id, old!.id))
		try {
			const all = await reader.client.articles.list({ view: "all", topic: ids["reader:Science"] })
			expect(all.items.map((a) => a.title)).toEqual(["Atoms", "Old atoms"])
			const inbox = await reader.client.articles.list({ topic: ids["reader:Science"] })
			expect(inbox.items.map((a) => a.title)).toEqual(["Atoms"])
			// The archive's filters: finished or not.
			const unfinished = await reader.client.articles.list({
				view: "all",
				filter: "unfinished",
				topic: ids["reader:Science"],
			})
			expect(unfinished.items.map((a) => a.title)).toEqual(["Atoms"])
			// Each filter counts the topic's articles only.
			expect(
				(await reader.client.articles.counts({ topic: ids["reader:Science"] })).counts,
			).toMatchObject({ unread: 1, read: 0 })
			expect(
				(await reader.client.articles.counts({ view: "archive", topic: ids["reader:Science"] }))
					.counts,
			).toMatchObject({ finished: 1, unfinished: 0 })
			const finished = await reader.client.articles.list({
				view: "all",
				filter: "finished",
				topic: ids["reader:Science"],
			})
			expect(finished.items.map((a) => a.title)).toEqual(["Old atoms"])
			// On its shelf too: the archived one counts, from 2020 it is not new, and the trash is out.
			const { items } = await reader.client.topics.list({ latest: 16 })
			const science = items.find((t) => t.name === "Science")!
			expect(science).toMatchObject({ articles: 2, savedThisWeek: 1 })
			expect(science.latest!.map((a) => a.title)).toEqual(["Atoms", "Old atoms"])
			const unread = await request("/api/v1/articles?view=all&filter=unread", {
				token: reader.token,
			})
			expect(unread.status).toBe(400)
		} finally {
			await db.delete(documents).where(eq(documents.id, old!.id))
			await db.delete(documents).where(eq(documents.id, trashed!.id))
		}
	})

	it("refuses a topic that ended, another reader's, or any while topics are off", async () => {
		for (const [client, topic] of [
			[reader.client, ids["reader:Ended"]],
			[reader.client, ids["without:Writing"]],
			[without.client, ids["without:Writing"]],
			[without.client, "none"],
		] as const) {
			await expect(client.articles.list({ topic })).rejects.toMatchObject({
				status: 404,
				code: "not_found",
			})
			// The filters' counts too: another reader's topic counts nothing of theirs.
			await expect(client.articles.counts({ view: "archive", topic })).rejects.toMatchObject({
				status: 404,
				code: "not_found",
			})
		}
		const trash = await request("/api/v1/articles?view=trash&topic=none", { token: reader.token })
		expect(trash.status).toBe(400)
		expect(await trash.json()).toMatchObject({ error: { code: "invalid_request" } })
	})
})

describe("GET /topics: the stage, and each topic's latest articles", () => {
	it("says which stage the reader's topics are in, and what each stage needs", async () => {
		const off = await users.create("Off")
		const waiting = await users.create("Waiting")
		const proposing = await users.create("Proposing")
		const proposed = await users.create("Proposed")
		for (const user of [off, waiting, proposing, proposed])
			await db.insert(userFeatures).values({ userId: user.id, feature: "topics" })
		await db.insert(topicLibraries).values({ userId: waiting.id })
		await article(waiting.id, "One")
		// Enough articles for the first topics: the worker is on it.
		await db.insert(topicLibraries).values({ userId: proposing.id })
		for (let i = 0; i < 25; i++) await article(proposing.id, `Article ${i}`)
		await db.insert(topicLibraries).values({ userId: proposed.id, proposedAt: new Date() })
		const [first] = await db
			.insert(topics)
			.values({
				userId: proposed.id,
				name: "Cooking",
				description: "About Cooking.",
				status: "proposed",
				origin: "first",
			})
			.returning({ id: topics.id })

		expect(await without.client.topics.list()).toEqual({ stage: "unavailable", items: [] })
		expect(await off.client.topics.list()).toEqual({
			stage: "off",
			items: [],
			progress: { count: 0, needed: 25 },
			invitation: false,
		})
		expect(await waiting.client.topics.list()).toEqual({
			stage: "waiting",
			items: [],
			progress: { count: 1, needed: 25 },
		})
		expect(await proposing.client.topics.list()).toEqual({
			stage: "proposing",
			items: [],
			progress: { count: 25, needed: 25 },
		})
		expect(await proposed.client.topics.list()).toEqual({
			stage: "proposed",
			items: [],
			proposed: [{ id: first!.id, name: "Cooking", description: "About Cooking." }],
			card: true,
		})
		expect(await reader.client.topics.list()).toEqual({
			stage: "active",
			items: [topicOf("Writing", 2), topicOf("Science", 1)],
			sorting: 0,
			sortingPaused: null,
		})
	})

	it("counts the library's articles still to sort, and says when sorting waits for next month", async () => {
		const [fresh] = await db
			.insert(documents)
			.values({
				userId: reader.id,
				sourceUrl: `https://example.com/${newId()}`,
				urlHash: newId(),
				status: "ready",
				title: "Fresh",
			})
			.returning({ id: documents.id })
		const { month, resetsAt } = monthOf()
		try {
			expect(await reader.client.topics.list()).toMatchObject({ sorting: 1, sortingPaused: null })
			// The month's sorts spent: it waits for the next month.
			await db
				.insert(usageCounts)
				.values({ userId: reader.id, metric: "topic_sorts", month, count: 1000 })
			expect(await reader.client.topics.list()).toMatchObject({
				sorting: 1,
				sortingPaused: { resumesAt: resetsAt.toISOString() },
			})
			// A server that sorts none at all: no month brings sorting back.
			vi.stubEnv("LIMIT_TOPIC_SORTS_PER_MONTH", "0")
			expect(await reader.client.topics.list()).toMatchObject({
				sorting: 1,
				sortingPaused: { resumesAt: null, max: 0 },
			})
		} finally {
			vi.unstubAllEnvs()
			await db.delete(documents).where(eq(documents.id, fresh!.id))
			await db.delete(usageCounts).where(eq(usageCounts.userId, reader.id))
		}
	})

	it("says when only the library's first sort waits for next month, new saves going on", async () => {
		const [old] = await db
			.insert(documents)
			.values({
				userId: reader.id,
				sourceUrl: `https://example.com/${newId()}`,
				urlHash: newId(),
				status: "ready",
				title: "Saved before confirming",
				createdAt: new Date(Date.UTC(2020, 0, 1)),
			})
			.returning({ id: documents.id })
		const { month, resetsAt } = monthOf()
		try {
			// Three quarters of the month's 1,000 sorts: the rest are for new saves.
			await db
				.insert(usageCounts)
				.values({ userId: reader.id, metric: "topic_sorts", month, count: 750 })
			const answer = await reader.client.topics.list()
			expect(answer).toEqual(
				expect.objectContaining({
					sorting: 1,
					sortingPaused: { resumesAt: resetsAt.toISOString(), library: true },
				}),
			)
		} finally {
			await db.delete(documents).where(eq(documents.id, old!.id))
			await db.delete(usageCounts).where(eq(usageCounts.userId, reader.id))
		}
	})

	it("counts one list's articles still to sort with view, even without a topic yet", async () => {
		const empty = await users.create("No topics yet")
		await db.insert(userFeatures).values({ userId: empty.id, feature: "topics" })
		await db
			.insert(topicLibraries)
			.values({ userId: empty.id, proposedAt: new Date(), confirmedAt: new Date() })
		// Neither sorted yet: one in the library, one archived.
		for (const title of ["Inbox", "Archived"]) {
			const [doc] = await db
				.insert(documents)
				.values({
					userId: empty.id,
					sourceUrl: `https://example.com/${newId()}`,
					urlHash: newId(),
					status: "ready",
					title,
					archivedAt: title === "Archived" ? new Date() : null,
				})
				.returning({ id: documents.id })
			void doc
		}
		expect(await empty.client.topics.list()).toMatchObject({ items: [], sorting: 2 })
		expect(await empty.client.topics.list({ view: "archive" })).toMatchObject({
			items: [],
			sorting: 1,
		})
	})

	it("counts what is left to read in each topic, and says when the reader last read from it", async () => {
		const [draft] = await db
			.select({ id: documents.id })
			.from(documents)
			.where(and(eq(documents.userId, reader.id), eq(documents.title, "Draft one")))
		const [atoms] = await db
			.select({ id: documents.id })
			.from(documents)
			.where(and(eq(documents.userId, reader.id), eq(documents.title, "Atoms")))
		const finishedAt = new Date("2026-10-01T10:00:00Z")
		const readAt = new Date("2026-10-05T10:00:00Z")
		// Finished: read, no longer to read. Opened and archived: read from, out of the library.
		await db.update(documents).set({ readAt: finishedAt }).where(eq(documents.id, draft!.id))
		await db
			.update(documents)
			.set({ lastReadAt: readAt, firstOpenedAt: readAt, archivedAt: new Date() })
			.where(eq(documents.id, atoms!.id))
		// In progress: still to read. Trashed, though read last: neither to read nor read from.
		const extra = async (
			title: string,
			topic: string,
			values: Partial<typeof documents.$inferInsert>,
		) => {
			const [doc] = await db
				.insert(documents)
				.values({
					userId: reader.id,
					sourceUrl: `https://example.com/${newId()}`,
					urlHash: newId(),
					status: "ready",
					title,
					...values,
				})
				.returning({ id: documents.id })
			await db
				.insert(documentTopics)
				.values({ documentId: doc!.id, topicId: topic, probability: 0.9, level: "applied" })
			return doc!.id
		}
		const opened = new Date("2026-09-20T10:00:00Z")
		const added = [
			await extra("Draft three", ids["reader:Writing"]!, {
				firstOpenedAt: opened,
				lastReadAt: opened,
				readingProgress: 0.3,
			}),
			await extra("Trashed atoms", ids["reader:Science"]!, {
				firstOpenedAt: new Date("2026-10-09T10:00:00Z"),
				lastReadAt: new Date("2026-10-09T10:00:00Z"),
				deletedAt: new Date(),
			}),
		]
		try {
			const { items } = await reader.client.topics.list()
			expect(items.map(({ name, toRead, lastReadAt }) => ({ name, toRead, lastReadAt }))).toEqual([
				{ name: "Writing", toRead: 2, lastReadAt: finishedAt.toISOString() },
				{ name: "Science", toRead: 0, lastReadAt: readAt.toISOString() },
			])
		} finally {
			for (const id of added) await db.delete(documents).where(eq(documents.id, id))
			await db.update(documents).set({ readAt: null }).where(eq(documents.id, draft!.id))
			await db
				.update(documents)
				.set({ lastReadAt: null, firstOpenedAt: null, archivedAt: null })
				.where(eq(documents.id, atoms!.id))
		}
	})

	it("gives each topic its newest articles with latest, as the library lists them", async () => {
		const { items } = await reader.client.topics.list({ latest: 1 })
		expect(items.map((t) => [t.name, t.latest?.map((a) => a.title)])).toEqual([
			["Writing", ["Draft two"]],
			["Science", ["Atoms"]],
		])
		expect(items[0]!.latest![0]).toMatchObject({ location: "inbox", tags: [] })
		const two = await reader.client.topics.list({ latest: 16 })
		expect(two.items[0]!.latest!.map((a) => a.title)).toEqual(["Draft two", "Draft one"])
		expect((await reader.client.topics.list()).items[0]).not.toHaveProperty("latest")
		for (const latest of [0, 17]) {
			const refused = await request(`/api/v1/topics?latest=${latest}`, { token: reader.token })
			expect(refused.status).toBe(400)
		}
	})
})

describe("MCP list_topics and list_library's topic", () => {
	type Result = { content: { text?: string }[]; isError?: boolean }
	const json = (result: unknown) =>
		JSON.parse((result as Result).content.map((c) => c.text ?? "").join(""))

	it("lists the topics, and a topic's articles", async () => {
		const mcp = await mcpClient(reader.mcpToken)
		clients.push(mcp)
		const listed = json(await mcp.callTool({ name: "list_topics", arguments: {} }))
		expect(listed.items).toEqual([
			{ id: ids["reader:Writing"], name: "Writing", description: "About Writing.", articles: 2 },
			{ id: ids["reader:Science"], name: "Science", description: "About Science.", articles: 1 },
		])
		const page = json(
			await mcp.callTool({
				name: "list_library",
				arguments: { topic: ids["reader:Science"] },
			}),
		)
		expect(titles(page)).toEqual(["Atoms"])
		// Archived: out of the library's list, in the whole library's.
		const [draft] = await db
			.select({ id: documents.id })
			.from(documents)
			.where(and(eq(documents.userId, reader.id), eq(documents.title, "Draft one")))
		await db.update(documents).set({ archivedAt: new Date() }).where(eq(documents.id, draft!.id))
		try {
			const list = async (view: string) =>
				titles(
					json(
						await mcp.callTool({
							name: "list_library",
							arguments: { view, topic: ids["reader:Writing"], filter: "unfinished" },
						}),
					),
				)
			expect(await list("all")).toEqual(["Draft one", "Draft two"])
			expect(await list("archive")).toEqual(["Draft one"])
		} finally {
			await db.update(documents).set({ archivedAt: null }).where(eq(documents.id, draft!.id))
		}
		const refused = (await mcp.callTool({
			name: "list_library",
			arguments: { topic: ids["reader:Ended"] },
		})) as Result
		expect(refused.isError).toBe(true)
	})
})
