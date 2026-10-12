import { db, documents, documentTopics, inArray, topics, user as userTable } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { operatorValues, searchDocuments } from "./search.server"

const userId = `test-search-topics-${Date.now()}`
const otherId = `${userId}-other`

async function addArticle(owner: string, title: string, archived = false): Promise<string> {
	const [d] = await db
		.insert(documents)
		.values({
			userId: owner,
			sourceUrl: `https://example.com/${encodeURIComponent(title)}`,
			urlHash: `${owner}-${title}`,
			title,
			status: "ready",
			archivedAt: archived ? new Date() : null,
		})
		.returning({ id: documents.id })
	return d!.id
}

async function addTopic(
	owner: string,
	name: string,
	status: "active" | "retired" = "active",
): Promise<string> {
	const [t] = await db
		.insert(topics)
		.values({ userId: owner, name, description: `About ${name}.`, status, origin: "first" })
		.returning({ id: topics.id })
	return t!.id
}

const put = (
	documentId: string,
	topicId: string,
	level: "applied" | "suggested" = "applied",
	refusedAt: Date | null = null,
) => db.insert(documentTopics).values({ documentId, topicId, probability: 0.9, level, refusedAt })

const titles = async (q: string, owner = userId) =>
	(await searchDocuments({ userId: owner, q })).items.map((d) => d.title).sort()

beforeAll(async () => {
	await db.insert(userTable).values([
		{ id: userId, name: "T", email: `${userId}@example.com` },
		{ id: otherId, name: "O", email: `${otherId}@example.com` },
	])
	const writing = await addTopic(userId, "Writing")
	const growth = await addTopic(userId, "Personal Growth")
	const quoted = await addTopic(userId, 'Say "No"')
	const retired = await addTopic(userId, "Old Shelf", "retired")
	const theirs = await addTopic(otherId, "Writing")

	await put(await addArticle(userId, "drafts"), writing)
	const both = await addArticle(userId, "both")
	await put(both, writing)
	await put(both, growth)
	await put(await addArticle(userId, "habits"), growth)
	await put(await addArticle(userId, "nearly writing"), writing, "suggested")
	await put(await addArticle(userId, "taken out"), writing, "applied", new Date())
	await addArticle(userId, "unsorted")
	await put(await addArticle(userId, "on an old shelf"), retired)
	await put(await addArticle(userId, "archived draft", true), writing)
	await put(await addArticle(userId, "boundaries"), quoted)
	await put(await addArticle(otherId, "their draft"), theirs)
})

afterAll(async () => {
	await db.delete(userTable).where(inArray(userTable.id, [userId, otherId]))
})

describe("topic: in the search", () => {
	it("finds the articles in a topic by its whole name, whatever the case, archived too", async () => {
		expect(await titles("topic:writing")).toEqual(["archived draft", "both", "drafts"])
		expect(await titles('topic:"personal growth"')).toEqual(["both", "habits"])
		expect(await titles("topic:writ")).toEqual([])
	})

	it("leaves out articles only suggested for it, and those the reader took out", async () => {
		const found = await titles("topic:Writing")
		expect(found).not.toContain("nearly writing")
		expect(found).not.toContain("taken out")
	})

	it("widens with repeats, and narrows with negations", async () => {
		expect(await titles('topic:Writing topic:"Personal Growth"')).toEqual([
			"archived draft",
			"both",
			"drafts",
			"habits",
		])
		expect(await titles('-topic:Writing -topic:"Personal Growth"')).toEqual([
			"boundaries",
			"nearly writing",
			"on an old shelf",
			"taken out",
			"unsorted",
		])
		expect(await titles("topic:Writing in:library")).toEqual(["both", "drafts"])
	})

	it("matches a name with quotes in it without them", async () => {
		expect(await titles('topic:"Say No"')).toEqual(["boundaries"])
	})

	it("finds nothing in a topic that ended, or in another reader's", async () => {
		expect(await titles('topic:"Old Shelf"')).toEqual([])
		expect(await titles("topic:Writing", otherId)).toEqual(["their draft"])
	})

	it("tells the articles in a topic from those in none", async () => {
		expect(await titles("has:topic")).toEqual([
			"archived draft",
			"both",
			"boundaries",
			"drafts",
			"habits",
		])
		expect(await titles("-has:topic")).toEqual([
			"nearly writing",
			"on an old shelf",
			"taken out",
			"unsorted",
		])
	})
})

describe("topic: values", () => {
	const values = (q: string, owner = userId) => operatorValues({ userId: owner, key: "topic", q })

	it("lists the reader's topics in use, most articles first, as far as typed", async () => {
		expect(await values("")).toEqual(["Writing", "Personal Growth", 'Say "No"'])
		expect(await values("GROW")).toEqual(["Personal Growth"])
		expect(await values("old")).toEqual([])
		expect(await values("", otherId)).toEqual(["Writing"])
	})
})
