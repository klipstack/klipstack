import { db, documents, documentTopics, eq, topicLibraries, topics, user } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { homeCandidates } from "./reading-suggestions.server"
import { homeTopics, topicLabels } from "./topics.server"

const userId = `test-home-topics-${Date.now()}`
const otherId = `${userId}-other`
const now = new Date("2026-10-10T12:00:00Z")
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000)
const ids: Record<string, string> = {}
const docIds: Record<string, string> = {}

type Save = Partial<typeof documents.$inferInsert> & { title: string }

async function article(owner: string, doc: Save) {
	const [row] = await db
		.insert(documents)
		.values({
			userId: owner,
			sourceUrl: `https://example.com/${encodeURIComponent(doc.title)}`,
			urlHash: `${owner}-${doc.title}`,
			status: "ready",
			readingMinutes: 10,
			createdAt: daysAgo(1),
			...doc,
		})
		.returning({ id: documents.id })
	docIds[doc.title] = row!.id
	return row!.id
}

async function topic(
	owner: string,
	name: string,
	status: "active" | "proposed" | "removed" = "active",
) {
	const [row] = await db
		.insert(topics)
		.values({ userId: owner, name, description: name, status, origin: "first" })
		.returning({ id: topics.id })
	ids[name] = row!.id
	return row!.id
}

async function sort(
	title: string,
	topicName: string,
	extra: Partial<typeof documentTopics.$inferInsert> = {},
) {
	await db.insert(documentTopics).values({
		documentId: docIds[title]!,
		topicId: ids[topicName]!,
		probability: 0.9,
		level: "applied",
		...extra,
	})
}

beforeAll(async () => {
	await db
		.insert(user)
		.values([userId, otherId].map((id) => ({ id, name: "Reader", email: `${id}@example.com` })))
	await db
		.insert(topicLibraries)
		.values({ userId, proposedAt: daysAgo(30), confirmedAt: daysAgo(30) })
	for (const name of ["Science", "Writing", "Economics", "Business"]) await topic(userId, name)
	await topic(userId, "Proposed", "proposed")
	await topic(userId, "Removed", "removed")
	await topic(otherId, "Theirs")

	// Science: three to read, one of them in progress; read from yesterday.
	for (const title of ["Science 1", "Science 2"]) await article(userId, { title })
	await article(userId, {
		title: "Science, in progress",
		firstOpenedAt: daysAgo(1),
		lastReadAt: daysAgo(1),
		readingProgress: 0.4,
	})
	// What is not to read: finished, archived, trashed, unready, refused, only suggested.
	await article(userId, { title: "Science, finished", readAt: daysAgo(2), lastReadAt: daysAgo(2) })
	await article(userId, { title: "Science, archived", archivedAt: daysAgo(2) })
	await article(userId, { title: "Science, trashed", deletedAt: daysAgo(2) })
	await article(userId, { title: "Science, processing", status: "processing" })
	await article(userId, { title: "Science, refused" })
	await article(userId, { title: "Science, nearly" })
	for (const title of [
		"Science 1",
		"Science 2",
		"Science, in progress",
		"Science, finished",
		"Science, archived",
		"Science, trashed",
		"Science, processing",
	])
		await sort(title, "Science")
	await sort("Science, refused", "Science", { refusedAt: daysAgo(1) })
	await sort("Science, nearly", "Science", { level: "suggested", probability: 0.4 })

	// Writing: two to read, last read from a month ago. Economics: two, never read from.
	for (const title of ["Writing 1", "Writing 2"]) {
		await article(userId, { title })
		await sort(title, "Writing")
	}
	await article(userId, {
		title: "Writing, read",
		readAt: daysAgo(30),
		lastReadAt: daysAgo(30),
		archivedAt: daysAgo(30),
	})
	await sort("Writing, read", "Writing")
	for (const title of ["Economics 1", "Economics 2"]) {
		await article(userId, { title })
		await sort(title, "Economics")
	}
	// Business: nothing left to read.
	await article(userId, { title: "Business, read", readAt: daysAgo(3), archivedAt: daysAgo(3) })
	await sort("Business, read", "Business")
	// In two topics: Writing first, by how well it fits.
	await article(userId, { title: "Both" })
	await sort("Both", "Writing", { probability: 0.95 })
	await sort("Both", "Science", { probability: 0.6 })

	// In topics no longer in use, or not confirmed: never offered, never a label.
	await article(userId, { title: "Shelved" })
	await sort("Shelved", "Proposed", { probability: 0.99 })
	await sort("Shelved", "Removed", { probability: 0.98 })

	await article(otherId, { title: "Their article" })
	await sort("Their article", "Theirs")
})

afterAll(async () => {
	for (const id of [userId, otherId]) await db.delete(user).where(eq(user.id, id))
})

describe("homeTopics", () => {
	it("lists the reader's topics with articles to read, most to read first", async () => {
		const { topics: list } = await homeTopics(userId)
		expect(list.map((t) => [t.name, t.toRead])).toEqual([
			["Science", 4],
			["Writing", 3],
			["Economics", 2],
		])
	})

	it("offers as something different the topic read from least lately, never read first", async () => {
		expect((await homeTopics(userId)).different).toBe(ids.Economics)
	})

	it("offers nothing different with a single topic: it would be the same one", async () => {
		const { topics: list, different } = await homeTopics(otherId)
		expect(list.map((t) => t.name)).toEqual(["Theirs"])
		expect(different).toBeNull()
	})

	it("is empty for a reader without topics, and knows nothing different", async () => {
		expect(await homeTopics(otherId.replace("other", "nobody"))).toEqual({
			topics: [],
			different: null,
		})
	})
})

describe("Home's candidates in a topic", () => {
	const all = async (topicId: string) => {
		const c = await homeCandidates(userId, {
			now,
			topicId,
			keep: { reading: 100, recent: 100, rediscover: 100 },
		})
		return [...c.reading, ...c.recent, ...c.rediscover].map((d) => d.title).sort()
	}

	it("keeps to the articles in it, without those taken out or only nearly in it", async () => {
		expect(await all(ids.Science!)).toEqual([
			"Both",
			"Science 1",
			"Science 2",
			"Science, in progress",
		])
	})

	it("has nothing from a topic of someone else's", async () => {
		expect(await all(ids.Theirs!)).toEqual([])
	})
})

describe("topicLabels", () => {
	it("names the topic each article fits best; none when only nearly in, taken out, or in a topic not in use", async () => {
		const labels = await topicLabels(userId, [
			docIds.Both!,
			docIds["Science 1"]!,
			docIds["Science, nearly"]!,
			docIds["Science, refused"]!,
			docIds.Shelved!,
		])
		expect(labels).toEqual({ [docIds.Both!]: "Writing", [docIds["Science 1"]!]: "Science" })
	})

	it("names no topic of someone else's", async () => {
		expect(await topicLabels(otherId, [docIds.Both!])).toEqual({})
	})
})
