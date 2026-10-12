import { randomUUID } from "node:crypto"
import { db, documents, documentTopics, eq, sql, topics, user as userTable } from "@klipstack/db"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { readerTopics } from "./topics.server"

const tag = `test-reader-topics-${randomUUID().slice(0, 8)}`
let userId: string

beforeEach(async () => {
	userId = `${tag}-${randomUUID().slice(0, 8)}`
	await db.insert(userTable).values({ id: userId, name: "Reader", email: `${userId}@example.com` })
})
afterAll(async () => {
	await db.delete(userTable).where(sql`${userTable.id} like ${`${tag}%`}`)
})

type ArticleState = Partial<
	Pick<typeof documents.$inferInsert, "readAt" | "readingProgress" | "archivedAt" | "deletedAt">
>

async function article(title: string, state: ArticleState = {}, owner = userId) {
	const [doc] = await db
		.insert(documents)
		.values({
			userId: owner,
			sourceUrl: `https://example.com/${randomUUID()}`,
			urlHash: randomUUID(),
			status: "ready",
			title,
			siteName: "Example",
			readingMinutes: 5,
			...state,
		})
		.returning({ id: documents.id })
	return doc!.id
}

async function topic(name: string, status: "active" | "retired" | "proposed" = "active") {
	const [row] = await db
		.insert(topics)
		.values({ userId, name, description: "d", status, origin: "first" })
		.returning({ id: topics.id })
	return row!.id
}

/** Scores an article as the worker leaves them: applied at 0.6 and above, suggested below. */
async function place(documentId: string, scores: [string, number][], refused: string[] = []) {
	await db.insert(documentTopics).values(
		scores.map(([topicId, probability]) => ({
			documentId,
			topicId,
			probability,
			level: probability >= 0.6 ? ("applied" as const) : ("suggested" as const),
			refusedAt: refused.includes(topicId) ? new Date() : null,
		})),
	)
}

describe("an article's topics in the reader", () => {
	it("names the applied topics, strongest first, leaving out suggested, refused and ended ones", async () => {
		const [writing, growth, ideas, books, old] = await Promise.all([
			topic("Writing"),
			topic("Personal Growth"),
			topic("Ideas"),
			topic("Books"),
			topic("Old", "retired"),
		])
		const open = await article("Open")
		await place(
			open,
			[
				[writing, 0.7],
				[growth, 0.95],
				[ideas, 0.5],
				[books, 0.9],
				[old, 0.99],
			],
			[books],
		)

		const result = await readerTopics(userId, open)

		expect(result.topics).toEqual([
			{ id: growth, name: "Personal Growth" },
			{ id: writing, name: "Writing" },
		])
	})

	it("shelves up to three unread articles of the strongest topic, closest in topics first", async () => {
		const [growth, writing, science] = await Promise.all([
			topic("Personal Growth"),
			topic("Writing"),
			topic("Science"),
		])
		const open = await article("Open")
		await place(open, [
			[growth, 0.9],
			[writing, 0.5],
		])
		const old = await topic("Old", "retired")
		// Saved in an order that is neither the closest first nor the newest first.
		const alone = await article("Alone")
		await place(alone, [[growth, 0.9]])
		// In progress still counts as unread.
		const started = await article("Started", { readingProgress: 0.3 })
		await place(started, [
			[growth, 0.6],
			[science, 0.99],
		])
		// The same topics in the same proportions as the open article.
		const twin = await article("Twin")
		await place(twin, [
			[growth, 0.9],
			[writing, 0.5],
		])
		// As close as Alone, and newer: a retired topic's score doesn't push it away.
		const shadow = await article("Shadow")
		await place(shadow, [
			[growth, 0.9],
			[old, 0.99],
		])
		const fourth = await article("Fourth")
		await place(fourth, [
			[growth, 0.6],
			[science, 0.95],
		])
		const apart = await article("Apart")
		await place(apart, [
			[growth, 0.7],
			[science, 0.8],
		])
		// Taken out of Writing by the reader: as close as Alone, not as Twin.
		const corrected = await article("Corrected")
		await place(
			corrected,
			[
				[growth, 0.9],
				[writing, 0.5],
			],
			[writing],
		)
		// Finished, archived, trashed, taken out of the topic, or only suggested for it: not on it.
		for (const state of [
			{ readAt: new Date() },
			{ readingProgress: 0.95 },
			{ archivedAt: new Date() },
			{ deletedAt: new Date() },
		])
			await place(await article("Done", state), [[growth, 0.9]])
		await place(await article("Taken out"), [[growth, 0.9]], [growth])
		await place(await article("Nearly"), [[growth, 0.5]])

		const { shelf } = await readerTopics(userId, open)

		expect(shelf).toEqual({
			topic: { id: growth, name: "Personal Growth" },
			unread: 7,
			items: [
				{
					id: twin,
					title: "Twin",
					siteName: "Example",
					sourceUrl: expect.any(String),
					readingMinutes: 5,
				},
				{
					id: corrected,
					title: "Corrected",
					siteName: "Example",
					sourceUrl: expect.any(String),
					readingMinutes: 5,
				},
				{
					id: shadow,
					title: "Shadow",
					siteName: "Example",
					sourceUrl: expect.any(String),
					readingMinutes: 5,
				},
			],
		})
	})

	it("takes the next topic when the strongest has nothing unread, and none when no topic has", async () => {
		const [growth, writing] = await Promise.all([topic("Personal Growth"), topic("Writing")])
		const open = await article("Open")
		await place(open, [
			[growth, 0.95],
			[writing, 0.7],
		])
		await place(await article("Read", { readAt: new Date() }), [[growth, 0.9]])
		const next = await article("Next")
		await place(next, [[writing, 0.8]])

		expect((await readerTopics(userId, open)).shelf).toMatchObject({
			topic: { name: "Writing" },
			unread: 1,
			items: [{ id: next }],
		})

		await db.update(documents).set({ readAt: new Date() }).where(eq(documents.id, next))
		expect(await readerTopics(userId, open)).toEqual({
			topics: [
				{ id: growth, name: "Personal Growth" },
				{ id: writing, name: "Writing" },
			],
			shelf: null,
		})
	})

	it("has nothing for an article without topics, a trashed one, or another reader's", async () => {
		const growth = await topic("Personal Growth")
		const bare = await article("Bare")
		await place(await article("Other"), [[growth, 0.9]])
		expect(await readerTopics(userId, bare)).toEqual({ topics: [], shelf: null })

		const trashed = await article("Trashed", { deletedAt: new Date() })
		await place(trashed, [[growth, 0.9]])
		expect(await readerTopics(userId, trashed)).toEqual({ topics: [], shelf: null })

		const strangerId = `${userId}-stranger`
		await db
			.insert(userTable)
			.values({ id: strangerId, name: "Stranger", email: `${strangerId}@example.com` })
		const theirs = await article("Theirs", {}, strangerId)
		await place(theirs, [[growth, 0.9]])
		expect(await readerTopics(userId, theirs)).toEqual({ topics: [], shelf: null })
		// Nor through a topic that isn't theirs.
		expect(await readerTopics(strangerId, theirs)).toEqual({ topics: [], shelf: null })
	})
})
