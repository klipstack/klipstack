import { db, eq, inArray, savedSearches, topics, user as userTable } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { missingTopics } from "~/services/topics.server"
import { dropTopicFromSavedSearch } from "./saved-searches.server"

const userId = `test-saved-topics-${Date.now()}`
const otherId = `${userId}-other`

async function saved(owner: string, name: string, query: string): Promise<string> {
	const [row] = await db
		.insert(savedSearches)
		.values({ userId: owner, name, query })
		.returning({ id: savedSearches.id })
	return row!.id
}

const queryOf = async (id: string) =>
	(await db.select().from(savedSearches).where(eq(savedSearches.id, id)))[0]?.query

beforeAll(async () => {
	await db.insert(userTable).values([
		{ id: userId, name: "T", email: `${userId}@example.com` },
		{ id: otherId, name: "O", email: `${otherId}@example.com` },
	])
	const topic = (owner: string, name: string, status: "active" | "retired" | "removed") => ({
		userId: owner,
		name,
		description: `About ${name}.`,
		status,
		origin: "first" as const,
	})
	await db
		.insert(topics)
		.values([
			topic(userId, "Writing", "active"),
			topic(userId, 'Say "No"', "active"),
			topic(userId, "Old Shelf", "retired"),
			topic(userId, "Gone", "removed"),
			topic(otherId, "Theirs", "active"),
		])
})

afterAll(async () => {
	await db.delete(userTable).where(inArray(userTable.id, [userId, otherId]))
})

describe("missingTopics", () => {
	it("lists, for each query, the topics it names that the reader no longer has", async () => {
		expect(
			await missingTopics(userId, [
				'topic:writing topic:"Old Shelf"',
				'-topic:Gone topic:"Say No"',
				"topic:Theirs",
				"tag:Writing is:unread",
			]),
		).toEqual([["Old Shelf"], ["Gone"], ["Theirs"], []])
	})
})

describe("dropTopicFromSavedSearch", () => {
	it("takes the topic out of the query, whatever its case, and keeps the rest", async () => {
		const id = await saved(userId, "Shelf", 'topic:"Old Shelf" is:unread -topic:"old shelf"')
		expect(await dropTopicFromSavedSearch(userId, id, "old shelf")).toMatchObject({
			id,
			query: "is:unread",
		})
		expect(await queryOf(id)).toBe("is:unread")
	})

	it("refuses to leave a search with nothing, which would find everything", async () => {
		const id = await saved(userId, "Only", 'topic:"Old Shelf"')
		await expect(dropTopicFromSavedSearch(userId, id, "Old Shelf")).rejects.toMatchObject({
			code: "invalid_request",
		})
		expect(await queryOf(id)).toBe('topic:"Old Shelf"')
	})

	it("refuses another reader's saved search, and a missing one", async () => {
		const theirs = await saved(otherId, "Theirs", "topic:Gone is:unread")
		await expect(dropTopicFromSavedSearch(userId, theirs, "Gone")).rejects.toMatchObject({
			code: "not_found",
		})
		expect(await queryOf(theirs)).toBe("topic:Gone is:unread")
		await expect(
			dropTopicFromSavedSearch(userId, "00000000-0000-4000-8000-000000000000", "Gone"),
		).rejects.toMatchObject({ code: "not_found" })
	})
})
