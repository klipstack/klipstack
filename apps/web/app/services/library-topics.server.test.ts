import {
	db,
	documents,
	documentTopics,
	inArray,
	topicSorts,
	topics,
	user as userTable,
} from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { countFilters, listDocuments } from "./documents.server"
import { listTopics } from "./topics.server"

const userId = `test-library-topics-${Date.now()}`
const otherId = `${userId}-other`
const ids: Record<string, string> = {}

async function addArticle(
	owner: string,
	title: string,
	values: Partial<typeof documents.$inferInsert> = {},
	{ sorted = true }: { sorted?: boolean } = {},
): Promise<string> {
	const [d] = await db
		.insert(documents)
		.values({
			userId: owner,
			sourceUrl: `https://example.com/${encodeURIComponent(title)}`,
			urlHash: `${owner}-${title}`,
			title,
			status: "ready",
			...values,
		})
		.returning({ id: documents.id })
	if (sorted) await db.insert(topicSorts).values({ documentId: d!.id, userId: owner })
	return d!.id
}

async function addTopic(owner: string, name: string, status: "active" | "retired" = "active") {
	const [t] = await db
		.insert(topics)
		.values({ userId: owner, name, description: `About ${name}.`, status, origin: "first" })
		.returning({ id: topics.id })
	return t!.id
}

const put = (documentId: string, topicId: string, refusedAt: Date | null = null) =>
	db
		.insert(documentTopics)
		.values({ documentId, topicId, probability: 0.9, level: "applied", refusedAt })

const titles = async (options: Omit<Parameters<typeof listDocuments>[0], "userId">) =>
	(await listDocuments({ userId, ...options })).items.map((d) => d.title).sort()

beforeAll(async () => {
	await db.insert(userTable).values([
		{ id: userId, name: "T", email: `${userId}@example.com` },
		{ id: otherId, name: "O", email: `${otherId}@example.com` },
	])
	ids.writing = await addTopic(userId, "Writing")
	ids.growth = await addTopic(userId, "Growth")
	const old = await addTopic(userId, "Old", "retired")
	ids.theirs = await addTopic(otherId, "Theirs")
	const opened = new Date("2026-09-01")

	await put(await addArticle(userId, "unread draft"), ids.writing)
	const both = await addArticle(userId, "half read", {
		firstOpenedAt: opened,
		readingProgress: 0.5,
	})
	await put(both, ids.writing)
	await put(both, ids.growth)
	await put(await addArticle(userId, "archived draft", { archivedAt: opened }), ids.writing)
	await addArticle(userId, "sorted, no topic")
	await addArticle(userId, "waiting", {}, { sorted: false })
	await addArticle(userId, "failed", { status: "failed" }, { sorted: false })
	await put(await addArticle(userId, "on an old shelf"), old)
	await put(await addArticle(userId, "taken out"), ids.writing, opened)
	await put(await addArticle(userId, "trashed draft", { deletedAt: opened }), ids.writing)
	await put(
		await addArticle(userId, "starred growth", { archivedAt: opened, starredAt: opened }),
		ids.growth,
	)
	await put(await addArticle(otherId, "their article"), ids.theirs)
})

afterAll(async () => {
	await db.delete(userTable).where(inArray(userTable.id, [userId, otherId]))
})

describe("listDocuments in a topic", () => {
	it("lists a view's articles in the topic, with its filter", async () => {
		expect(await titles({ view: "inbox", topic: ids.writing })).toEqual([
			"half read",
			"unread draft",
		])
		expect(await titles({ view: "inbox", filter: "unread", topic: ids.writing })).toEqual([
			"unread draft",
		])
		expect(await titles({ view: "archive", topic: ids.writing })).toEqual(["archived draft"])
		expect(await titles({ view: "starred", topic: ids.growth })).toEqual(["starred growth"])
	})

	it("lists the articles sorted into no topic, not those still waiting", async () => {
		expect(await titles({ view: "inbox", topic: "none" })).toEqual([
			"on an old shelf",
			"sorted, no topic",
			"taken out",
		])
	})

	it("finds nothing of the reader's in another reader's topic", async () => {
		expect(await titles({ view: "inbox", topic: ids.theirs! })).toEqual([])
	})
})

describe("countFilters in a topic", () => {
	it("counts the topic's articles for each filter chip", async () => {
		expect(await countFilters(userId, "inbox", ids.writing)).toMatchObject({
			unread: 1,
			progress: 1,
			read: 0,
		})
		expect(await countFilters(userId, "inbox", "none")).toMatchObject({ unread: 3, progress: 0 })
	})
})

describe("listTopics", () => {
	it("counts each topic's articles in the list, most first, and the rest", async () => {
		const all = await listTopics(userId, "inbox", null)
		expect(all.topics.map(({ name, count }) => ({ name, count }))).toEqual([
			{ name: "Writing", count: 2 },
			{ name: "Growth", count: 1 },
		])
		expect(all).toMatchObject({ none: 3, sorting: 1 })
		expect(all.topics[0]).toMatchObject({ id: ids.writing, description: "About Writing." })
	})

	it("follows the filter and the view, keeping topics with nothing in it", async () => {
		const unread = await listTopics(userId, "inbox", "unread")
		expect(unread.topics.map(({ name, count }) => ({ name, count }))).toEqual([
			{ name: "Writing", count: 1 },
			{ name: "Growth", count: 0 },
		])
		const starred = await listTopics(userId, "starred", null)
		expect(starred.topics.map(({ name, count }) => ({ name, count }))).toEqual([
			{ name: "Growth", count: 1 },
			{ name: "Writing", count: 0 },
		])
		expect(starred).toMatchObject({ none: 0, sorting: 0 })
	})
})
