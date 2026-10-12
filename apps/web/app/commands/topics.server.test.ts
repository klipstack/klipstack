import { randomUUID } from "node:crypto"
import {
	and,
	db,
	documents,
	documentTopics,
	documentVersions,
	eq,
	inArray,
	savedSearches,
	sql,
	topicLibraries,
	topicSorts,
	topics,
	user as userTable,
	userFeatures,
} from "@klipstack/db"
import { stopBoss } from "@klipstack/queue"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

vi.hoisted(() => {
	process.env.AI_FAKE = "1"
})

const {
	confirmTopics,
	disableTopics,
	dismissTopicsCard,
	enableTopics,
	endTopicsInvitation,
	markTopicsSeen,
	queueTopicsIfOn,
	removeTopic,
	renameTopic,
	takeOutOfTopic,
} = await import("./topics.server")
const { firstTopicsNotice, topicsInvitation, topicsState, topicWithArticles } =
	await import("~/services/topics.server")
const { topicModels } = await import("~/lib/ai.server")

const tag = `test-topics-${randomUUID().slice(0, 8)}`
let userId: string
let otherId: string

beforeEach(async () => {
	userId = `${tag}-${randomUUID().slice(0, 8)}`
	otherId = `${userId}-other`
	await db.insert(userTable).values([
		{ id: userId, name: "Reader", email: `${userId}@example.com` },
		{ id: otherId, name: "Other", email: `${otherId}@example.com` },
	])
	await db.insert(userFeatures).values([
		{ userId, feature: "topics" },
		{ userId: otherId, feature: "topics" },
	])
})
afterAll(async () => {
	await db.delete(userTable).where(sql`${userTable.id} like ${`${tag}%`}`)
	await stopBoss()
})

async function article(owner = userId, { deleted = false } = {}) {
	const [doc] = await db
		.insert(documents)
		.values({
			userId: owner,
			sourceUrl: `https://example.com/${randomUUID()}`,
			urlHash: randomUUID(),
			status: "ready",
			title: "An article",
			deletedAt: deleted ? new Date() : null,
		})
		.returning({ id: documents.id })
	const [version] = await db
		.insert(documentVersions)
		.values({
			documentId: doc!.id,
			version: 1,
			html: "<p>Text</p>",
			text: "Text",
			textHash: randomUUID(),
			extractor: "test",
			extractorVersion: "1",
		})
		.returning({ id: documentVersions.id })
	await db.update(documents).set({ currentVersionId: version!.id }).where(eq(documents.id, doc!.id))
	return doc!.id
}

/** What the worker leaves after a proposal: the first topics, waiting for the reader. */
async function proposed(owner = userId, names = ["Writing Online", "Engineering Management"]) {
	await db
		.insert(topicLibraries)
		.values({ userId: owner, proposedAt: new Date() })
		.onConflictDoUpdate({
			target: topicLibraries.userId,
			set: { proposedAt: new Date() },
		})
	return db
		.insert(topics)
		.values(
			names.map((name) => ({
				userId: owner,
				name,
				description: `About ${name}.`,
				status: "proposed" as const,
				origin: "first" as const,
			})),
		)
		.returning({ id: topics.id, name: topics.name })
}

/** An active topic with `articleIds` in it, as the worker sorts them. */
async function active(owner: string, name: string, articleIds: string[]) {
	await db
		.insert(topicLibraries)
		.values({ userId: owner, proposedAt: new Date(), confirmedAt: new Date() })
		.onConflictDoNothing()
	const [topic] = await db
		.insert(topics)
		.values({ userId: owner, name, description: "d", status: "active", origin: "first" })
		.returning({ id: topics.id })
	if (articleIds.length)
		await db.insert(documentTopics).values(
			articleIds.map((documentId) => ({
				documentId,
				topicId: topic!.id,
				probability: 0.9,
				level: "applied" as const,
			})),
		)
	return topic!.id
}

async function queuedRuns(owner: string) {
	const rows = await db.execute<{ count: number }>(
		sql`select count(*)::int as count from pgboss.job where name = 'topics' and data->>'userId' = ${owner}`,
	)
	return rows.rows[0]!.count
}

describe("turning topics on and off", () => {
	it("is refused without the account's feature, and asks the worker for a run once on", async () => {
		await db.delete(userFeatures).where(eq(userFeatures.userId, userId))
		await expect(enableTopics(userId)).rejects.toMatchObject({ code: "forbidden" })
		expect(await topicsState(userId)).toMatchObject({ stage: "off" })

		await db.insert(userFeatures).values({ userId, feature: "topics" })
		await enableTopics(userId)
		await enableTopics(userId)
		expect(await topicsState(userId)).toMatchObject({ stage: "waiting", count: 0, needed: 25 })
		expect(await queuedRuns(userId)).toBe(1)
	})

	it("off deletes the reader's topics, where articles were and what was refused; nobody else's", async () => {
		const mine = await article()
		const theirs = await article(otherId)
		const topic = await active(userId, "Mine", [mine])
		const other = await active(otherId, "Theirs", [theirs])
		await db.insert(topicSorts).values({ documentId: mine, userId })
		await takeOutOfTopic(userId, topic, mine)

		await disableTopics(userId)
		expect(await topicsState(userId)).toMatchObject({ stage: "off" })
		expect(await db.select().from(topics).where(eq(topics.userId, userId))).toEqual([])
		expect(
			await db.select().from(documentTopics).where(eq(documentTopics.documentId, mine)),
		).toEqual([])
		expect(await db.select().from(topicSorts).where(eq(topicSorts.userId, userId))).toEqual([])
		expect(await topicWithArticles(otherId, other)).toMatchObject({ items: [{ id: theirs }] })
	})
})

describe("where topics stand", () => {
	it("waits for 25 ready articles, then shows the proposal as unseen until opened", async () => {
		await enableTopics(userId)
		for (let i = 0; i < 24; i++) await article()
		await article(userId, { deleted: true })
		expect(await topicsState(userId)).toMatchObject({ stage: "waiting", count: 24 })
		await article()
		expect(await topicsState(userId)).toMatchObject({ stage: "proposing", count: 25 })

		await proposed()
		expect(await topicsState(userId)).toMatchObject({
			stage: "proposed",
			unseen: true,
			topics: [{ name: "Engineering Management" }, { name: "Writing Online" }],
		})
		await markTopicsSeen(userId)
		expect(await topicsState(userId)).toMatchObject({ unseen: false })
	})

	it("after an empty proposal, waits for five more articles", async () => {
		await db.insert(topicLibraries).values({ userId, proposedAtCount: 25 })
		expect(await topicsState(userId)).toMatchObject({ stage: "waiting", needed: 30 })
	})

	it("counts a topic's articles without the refused and the trashed", async () => {
		const [kept, refused, trashed] = [await article(), await article(), await article()]
		const topic = await active(userId, "Shelf", [kept, refused, trashed])
		await takeOutOfTopic(userId, topic, refused)
		await db.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, trashed))
		expect(await topicsState(userId)).toMatchObject({
			stage: "active",
			topics: [{ name: "Shelf", articles: 1 }],
		})
		expect((await topicWithArticles(userId, topic))!.items.map((i) => i.id)).toEqual([kept])
	})

	it("shelves a topic's newest 16 articles, and counts the ones saved this week", async () => {
		const ids: string[] = []
		for (let i = 0; i < 18; i++) ids.push(await article())
		// One saved every three days, the last one today: three of them in the last seven days.
		for (const [i, id] of ids.entries())
			await db
				.update(documents)
				.set({
					createdAt: sql`now() - make_interval(days => ${(17 - i) * 3})`,
					title: `Article ${i}`,
					siteName: `site-${i % 3}`,
					wordCount: 100 * (i + 1),
				})
				.where(eq(documents.id, id))
		const trashed = await article()
		const topic = await active(userId, "Shelf", [...ids, trashed])
		await db.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, trashed))
		// Another topic, of the two oldest only: each topic has a shelf of its own newest.
		const other = await active(userId, "Other shelf", ids.slice(0, 2))

		const state = await topicsState(userId)
		const [shelf, second] = state.topics
		expect(second).toMatchObject({ id: other, articles: 2, recent: 0 })
		expect(second!.books.map((b) => b.id)).toEqual([ids[1], ids[0]])
		expect(shelf).toMatchObject({ id: topic, articles: 18, recent: 3 })
		expect(shelf!.books).toHaveLength(16)
		expect(shelf!.books[0]).toEqual({
			id: ids[17],
			title: "Article 17",
			siteName: "site-2",
			wordCount: 1800,
			recent: true,
		})
		expect(shelf!.books.filter((b) => b.recent)).toHaveLength(3)
		expect(shelf!.books.map((b) => b.id)).toEqual(ids.slice(2).reverse())
	})
})

describe("confirming the first topics", () => {
	it("keeps the chosen ones under the reader's names, removes the others, and asks for a run", async () => {
		await expect(confirmTopics(userId, { keep: [] })).rejects.toMatchObject({ code: "not_found" })
		const [writing, management] = await proposed()
		await confirmTopics(userId, { keep: [{ id: writing!.id, name: "  Writing   in public " }] })

		const rows = await db.select().from(topics).where(eq(topics.userId, userId))
		expect(rows.find((t) => t.id === writing!.id)).toMatchObject({
			status: "active",
			name: "Writing in public",
			namedByReader: true,
		})
		expect(rows.find((t) => t.id === management!.id)).toMatchObject({ status: "removed" })
		expect(await topicsState(userId)).toMatchObject({ stage: "active", unseen: false })
		expect(await queuedRuns(userId)).toBe(1)

		await expect(confirmTopics(userId, { keep: [] })).rejects.toMatchObject({
			code: "already_done",
		})
	})

	it("refuses a topic that is not in the proposal, and a name past the limit", async () => {
		await proposed()
		const [theirs] = await proposed(otherId)
		await expect(confirmTopics(userId, { keep: [{ id: theirs!.id }] })).rejects.toMatchObject({
			code: "not_found",
		})
		const [mine] = await db.select().from(topics).where(eq(topics.userId, userId))
		await expect(
			confirmTopics(userId, { keep: [{ id: mine!.id, name: "x".repeat(61) }] }),
		).rejects.toMatchObject({ code: "invalid_request" })
		expect(await topicsState(userId)).toMatchObject({ stage: "proposed" })
	})
})

describe("correcting topics", () => {
	it("renames a topic for good, and refuses another reader's", async () => {
		const topic = await active(userId, "Shelf", [])
		const theirs = await active(otherId, "Theirs", [])
		expect(await renameTopic(userId, topic, " Better  name ")).toEqual({
			id: topic,
			name: "Better name",
		})
		const [row] = await db.select().from(topics).where(eq(topics.id, topic))
		expect(row).toMatchObject({ name: "Better name", namedByReader: true })
		await expect(renameTopic(userId, theirs, "Mine now")).rejects.toMatchObject({
			code: "not_found",
		})
		await expect(renameTopic(userId, topic, "")).rejects.toMatchObject({ code: "invalid_request" })
	})

	it("takes the reader's saved searches along to the new name, and no one else's", async () => {
		const topic = await active(userId, "Old Shelf", [])
		await db.insert(savedSearches).values([
			{ userId, name: "Shelf", query: 'topic:"old shelf" is:unread' },
			{ userId: otherId, name: "Theirs", query: 'topic:"Old Shelf"' },
		])
		await renameTopic(userId, topic, "New Shelf")
		const rows = await db
			.select({ userId: savedSearches.userId, query: savedSearches.query })
			.from(savedSearches)
			.where(inArray(savedSearches.userId, [userId, otherId]))
			.orderBy(savedSearches.name)
		expect(rows).toEqual([
			{ userId, query: 'topic:"New Shelf" is:unread' },
			{ userId: otherId, query: 'topic:"Old Shelf"' },
		])
	})

	it("removes a topic: its articles leave it, and its name stays taken", async () => {
		const doc = await article()
		const topic = await active(userId, "Shelf", [doc])
		await removeTopic(userId, topic)
		const [row] = await db.select().from(topics).where(eq(topics.id, topic))
		expect(row).toMatchObject({ status: "removed" })
		expect(await db.select().from(documentTopics).where(eq(documentTopics.topicId, topic))).toEqual(
			[],
		)
		await expect(removeTopic(userId, topic)).rejects.toMatchObject({ code: "not_found" })
	})

	it("takes articles out of a topic for good, refusing another reader's or a trashed one", async () => {
		const [inIt, notInIt] = [await article(), await article()]
		const topic = await active(userId, "Shelf", [inIt])
		await takeOutOfTopic(userId, topic, inIt)
		await takeOutOfTopic(userId, topic, notInIt)
		const rows = await db.select().from(documentTopics).where(eq(documentTopics.topicId, topic))
		expect(rows.map((r) => [r.documentId, r.refusedAt !== null]).sort()).toEqual(
			[
				[inIt, true],
				[notInIt, true],
			].sort(),
		)
		const theirs = await article(otherId)
		const trashed = await article(userId, { deleted: true })
		for (const id of [theirs, trashed])
			await expect(takeOutOfTopic(userId, topic, id)).rejects.toMatchObject({
				code: "not_found",
			})
		const [refused] = await db
			.select()
			.from(documentTopics)
			.where(and(eq(documentTopics.topicId, topic), eq(documentTopics.documentId, inIt)))
		expect(refused!.refusedAt).not.toBeNull()
	})
})

describe("names, other readers and the feature", () => {
	it("refuse a name another topic has, on rename and on confirm", async () => {
		const [writing, management] = await proposed()
		await expect(
			confirmTopics(userId, {
				keep: [{ id: writing!.id }, { id: management!.id, name: "writing online" }],
			}),
		).rejects.toMatchObject({ code: "name_taken" })
		await confirmTopics(userId, { keep: [{ id: writing!.id }, { id: management!.id }] })
		await expect(renameTopic(userId, management!.id, "WRITING ONLINE")).rejects.toMatchObject({
			code: "name_taken",
		})
		// Its own name, in another case, is no clash.
		expect(await renameTopic(userId, writing!.id, "writing online")).toMatchObject({
			name: "writing online",
		})
	})

	it("refuse another reader's topic: removing it, or opening it", async () => {
		const theirs = await active(otherId, "Theirs", [await article(otherId)])
		await expect(removeTopic(userId, theirs)).rejects.toMatchObject({ code: "not_found" })
		expect(await topicWithArticles(userId, theirs)).toBeNull()
	})

	it("refuse every change once the feature is gone, but let the reader turn topics off", async () => {
		const doc = await article()
		const topic = await active(userId, "Shelf", [doc])
		await db.delete(userFeatures).where(eq(userFeatures.userId, userId))
		for (const change of [
			() => renameTopic(userId, topic, "Other"),
			() => removeTopic(userId, topic),
			() => takeOutOfTopic(userId, topic, doc),
			() => markTopicsSeen(userId),
			() => dismissTopicsCard(userId),
			() => endTopicsInvitation(userId),
			() => confirmTopics(userId, { keep: [] }),
		])
			await expect(change()).rejects.toMatchObject({ code: "forbidden" })
		await disableTopics(userId)
		expect(await topicsState(userId)).toMatchObject({ stage: "off" })
	})

	it("put Home's card away with Not now, and keep the sidebar's dot until the proposal is opened", async () => {
		await proposed()
		expect(await firstTopicsNotice(userId)).toEqual({ dot: true, card: true })
		await dismissTopicsCard(userId)
		expect(await firstTopicsNotice(userId)).toEqual({ dot: true, card: false })
		await markTopicsSeen(userId)
		expect(await firstTopicsNotice(userId)).toEqual({ dot: false, card: false })
	})
})

describe("Home's invitation to topics", () => {
	it("comes with 25 ready articles while topics are off, and only for an account with the feature", async () => {
		for (let i = 0; i < 24; i++) await article()
		await article(userId, { deleted: true })
		expect(await topicsInvitation(userId)).toBeNull()
		await article()
		expect(await topicsInvitation(userId)).toEqual({ count: 25 })

		// A server without both model keys invites nobody, whatever the account's flag.
		const available = vi.spyOn(topicModels, "available", "get").mockReturnValue(false)
		try {
			expect(await topicsInvitation(userId)).toBeNull()
		} finally {
			available.mockRestore()
		}

		await db.delete(userFeatures).where(eq(userFeatures.userId, userId))
		expect(await topicsInvitation(userId)).toBeNull()
	})

	it("ends for good once declined, or the Topics page opened: nobody else's", async () => {
		for (let i = 0; i < 25; i++) await article()
		for (let i = 0; i < 25; i++) await article(otherId)
		await endTopicsInvitation(userId)
		expect(await topicsInvitation(userId)).toBeNull()
		expect(await topicsInvitation(otherId)).toEqual({ count: 25 })
		// It keeps the first time it ended.
		const endedAt = async () =>
			(
				await db.select({ prefs: userTable.prefs }).from(userTable).where(eq(userTable.id, userId))
			)[0]!.prefs.topicsInvitationEndedAt
		const first = await endedAt()
		expect(first).toBeTruthy()
		await new Promise((resolve) => setTimeout(resolve, 5))
		await endTopicsInvitation(userId)
		expect(await endedAt()).toBe(first)
	})

	it("goes while topics are on, and does not come back once they are turned off", async () => {
		for (let i = 0; i < 25; i++) await article()
		await enableTopics(userId)
		expect(await topicsInvitation(userId)).toBeNull()
		await disableTopics(userId)
		expect(await topicsInvitation(userId)).toBeNull()
	})

	it("is not shown to a reader whose topics are on from before it existed", async () => {
		for (let i = 0; i < 25; i++) await article()
		await db.insert(topicLibraries).values({ userId })
		expect(await topicsInvitation(userId)).toBeNull()
	})
})

describe("racing the worker", () => {
	it("turning off waits for a worker's write in progress, then deletes what it wrote too", async () => {
		await db.insert(topicLibraries).values({ userId })
		let release!: () => void
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		let locked!: () => void
		const holding = new Promise<void>((resolve) => {
			locked = resolve
		})
		// As the worker writes: the reader's row locked for share, then rows of its own.
		const worker = db.transaction(async (tx) => {
			await tx.select().from(topicLibraries).where(eq(topicLibraries.userId, userId)).for("share")
			locked()
			await gate
			await tx.insert(topics).values({
				userId,
				name: "Late",
				description: "Written by a run still on.",
				status: "proposed",
				origin: "first",
			})
		})
		await holding
		const off = disableTopics(userId)
		await new Promise((resolve) => setTimeout(resolve, 100))
		release()
		await worker
		await off
		expect(await db.select().from(topics).where(eq(topics.userId, userId))).toEqual([])
		expect(await topicsState(userId)).toMatchObject({ stage: "off" })
	})

	it("a topic of a name in use cannot be made twice, whoever makes it", async () => {
		await active(userId, "Pets", [])
		await expect(
			db.insert(topics).values({
				userId,
				name: "pets",
				description: "d",
				status: "active",
				origin: "grown",
			}),
		).rejects.toThrow()
		// A removed name may come back: the index holds only names in use.
		await db.update(topics).set({ status: "removed" }).where(eq(topics.userId, userId))
		await active(userId, "Pets", [])
	})

	it("an article restored from the trash is sorted again, as if new", async () => {
		const doc = await article()
		await db.insert(topicLibraries).values({ userId })
		await db.insert(topicSorts).values({ documentId: doc, userId })
		await queueTopicsIfOn(userId, doc)
		expect(await db.select().from(topicSorts).where(eq(topicSorts.documentId, doc))).toEqual([])
		expect(await queuedRuns(userId)).toBe(1)
	})
})
