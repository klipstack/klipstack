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
	// Every article here was saved just now.
	savedThisWeek: articles,
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
		const response = await request("/api/v1/topics", { token: reader.key })
		const body = (await response.json()) as { items: Record<string, unknown>[] }
		expect(body.items.map((t) => Object.keys(t).sort())).toEqual([
			["articles", "description", "id", "name", "savedThisWeek"],
			["articles", "description", "id", "name", "savedThisWeek"],
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
					{ ...topicOf("Science", 1), inView: 1 },
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
					{ ...topicOf("Science", 1), inView: 0 },
				],
				none: 1,
				sorting: 1,
			})
			expect(await without.client.topics.list({ view: "inbox" })).toEqual({
				stage: "unavailable",
				items: [],
			})
			const trash = await request("/api/v1/topics?view=trash", { token: reader.key })
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
		// Archived: in the whole library, out of the inbox.
		await db.update(documents).set({ archivedAt: new Date() }).where(eq(documents.id, old!.id))
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
			expect(unfinished.items.map((a) => a.title)).toEqual(["Atoms", "Old atoms"])
			const unread = await request("/api/v1/articles?view=all&filter=unread", {
				token: reader.key,
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
		}
		const trash = await request("/api/v1/articles?view=trash&topic=none", { token: reader.key })
		expect(trash.status).toBe(400)
		expect(await trash.json()).toMatchObject({ error: { code: "invalid_request" } })
	})
})

describe("GET /topics: the stage, and each topic's latest articles", () => {
	it("says which stage the reader's topics are in, and what each stage needs", async () => {
		const off = await users.create("Off")
		const waiting = await users.create("Waiting")
		const proposed = await users.create("Proposed")
		for (const user of [off, waiting, proposed])
			await db.insert(userFeatures).values({ userId: user.id, feature: "topics" })
		await db.insert(topicLibraries).values({ userId: waiting.id })
		await article(waiting.id, "One")
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
		expect(await off.client.topics.list()).toEqual({ stage: "off", items: [] })
		expect(await waiting.client.topics.list()).toEqual({
			stage: "waiting",
			items: [],
			progress: { count: 1, needed: 25 },
		})
		expect(await proposed.client.topics.list()).toEqual({
			stage: "proposed",
			items: [],
			proposed: [{ id: first!.id, name: "Cooking", description: "About Cooking." }],
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
		} finally {
			await db.delete(documents).where(eq(documents.id, fresh!.id))
			await db.delete(usageCounts).where(eq(usageCounts.userId, reader.id))
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
			const refused = await request(`/api/v1/topics?latest=${latest}`, { token: reader.key })
			expect(refused.status).toBe(400)
		}
	})
})

describe("MCP list_topics and list_library's topic", () => {
	type Result = { content: { text?: string }[]; isError?: boolean }
	const json = (result: unknown) =>
		JSON.parse((result as Result).content.map((c) => c.text ?? "").join(""))

	it("lists the topics, and a topic's articles", async () => {
		const mcp = await mcpClient(reader.key)
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
		const all = json(
			await mcp.callTool({
				name: "list_library",
				arguments: { view: "all", topic: ids["reader:Writing"] },
			}),
		)
		expect(titles(all)).toEqual(["Draft one", "Draft two"])
		const refused = (await mcp.callTool({
			name: "list_library",
			arguments: { topic: ids["reader:Ended"] },
		})) as Result
		expect(refused.isError).toBe(true)
	})
})
