import {
	and,
	db,
	documents,
	documentTopics,
	eq,
	monthOf,
	topicLibraries,
	topics,
	usageCounts,
	userFeatures,
} from "@klipstack/db"
import { stopBoss } from "@klipstack/queue"
import type { KlipstackApiError } from "@klipstack/sdk"
import { afterAll, describe, expect, it, vi } from "vitest"
import { topicModels } from "~/lib/ai.server"
import { env } from "~/lib/env.server"
import { apiUsers, request } from "~/test/api-harness"
import { insertArticle, urlHash } from "../../e2e/seed"

// Topic models, as on a server with both keys.
vi.hoisted(() => {
	process.env.AI_FAKE = "1"
})

/**
 * GET /api/v1/articles/{id}/topics, and turning topics on, confirming and correcting them, through
 * the SDK as the iPhone app calls it.
 */

const origin = new URL(env.APP_URL).origin
const MISSING = "00000000-0000-4000-8000-000000000000"
const users = apiUsers("api-topics")
afterAll(async () => {
	await users.cleanup()
	await stopBoss()
})

const errorOf = (promise: Promise<unknown>) =>
	promise.then(
		() => {
			throw new Error("expected the call to fail")
		},
		(e: unknown) => e as KlipstackApiError,
	)

async function topic(userId: string, name: string) {
	const [row] = await db
		.insert(topics)
		.values({ userId, name, description: "d", status: "active", origin: "first" })
		.returning({ id: topics.id })
	return row!.id
}

function place(documentId: string, scores: [string, number][]) {
	return db.insert(documentTopics).values(
		scores.map(([topicId, probability]) => ({
			documentId,
			topicId,
			probability,
			level: probability >= 0.6 ? ("applied" as const) : ("suggested" as const),
		})),
	)
}

describe("an article's topics in the API", () => {
	it("names its topics and the shelf of what to read next, with the feature", async () => {
		const me = await users.create("Topics")
		await db.insert(userFeatures).values({ userId: me.id, feature: "topics" })
		const [growth, writing] = [await topic(me.id, "Personal Growth"), await topic(me.id, "Writing")]
		const open = await insertArticle(me.id, "Open", "<p>Open.</p>")
		await place(open, [
			[growth, 0.95],
			[writing, 0.7],
		])
		const near = await insertArticle(me.id, "Near", "<p>Near.</p>")
		await place(near, [
			[growth, 0.9],
			[writing, 0.65],
		])
		const far = await insertArticle(me.id, "Far", "<p>Far.</p>")
		await place(far, [[growth, 0.7]])
		await db.update(documents).set({ readingMinutes: 7 }).where(eq(documents.id, near))

		const answer = await me.client.articles.topics(open)
		expect(answer).toEqual({
			topics: [
				{ id: growth, name: "Personal Growth" },
				{ id: writing, name: "Writing" },
			],
			shelf: {
				topic: { id: growth, name: "Personal Growth" },
				unread: 2,
				items: [
					expect.objectContaining({ id: near, title: "Near", readingMinutes: 7 }),
					expect.objectContaining({ id: far, title: "Far", readingMinutes: null }),
				],
			},
		})
		expect(answer.shelf?.items[0]).toEqual({
			id: near,
			title: "Near",
			siteName: null,
			url: expect.stringMatching(/^https:\/\/example\.com\/near-/),
			readingMinutes: 7,
			readerUrl: `${origin}/read/${near}`,
		})
	})

	it("is empty without the feature, without topic models, or for an article without text yet", async () => {
		const me = await users.create("No topics")
		const growth = await topic(me.id, "Personal Growth")
		const open = await insertArticle(me.id, "Open", "<p>Open.</p>")
		await place(open, [[growth, 0.95]])
		await place(await insertArticle(me.id, "Next", "<p>Next.</p>"), [[growth, 0.9]])
		expect(await me.client.articles.topics(open)).toEqual({ topics: [], shelf: null })

		await db.insert(userFeatures).values({ userId: me.id, feature: "topics" })
		expect((await me.client.articles.topics(open)).topics).toHaveLength(1)
		// A server without both model keys has no topics to show, whatever the account's flag.
		const available = vi.spyOn(topicModels, "available", "get").mockReturnValue(false)
		try {
			expect(await me.client.articles.topics(open)).toEqual({ topics: [], shelf: null })
		} finally {
			available.mockRestore()
		}
		const url = `https://example.com/queued-${open}`
		const [queued] = await db
			.insert(documents)
			.values({ userId: me.id, sourceUrl: url, urlHash: urlHash(url), status: "queued" })
			.returning({ id: documents.id })
		await place(queued!.id, [[growth, 0.95]])
		expect(await me.client.articles.topics(queued!.id)).toEqual({ topics: [], shelf: null })
	})

	it("is not_found for a missing, trashed or foreign article", async () => {
		const me = await users.create("Mine")
		const other = await users.create("Theirs")
		await db.insert(userFeatures).values({ userId: me.id, feature: "topics" })
		const theirs = await insertArticle(other.id, "Theirs", "<p>Theirs.</p>")
		const trashed = await insertArticle(me.id, "Trashed", "<p>Trashed.</p>")
		await db.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, trashed))
		for (const id of [MISSING, theirs, trashed])
			expect(await errorOf(me.client.articles.topics(id))).toMatchObject({
				status: 404,
				code: "not_found",
			})
	})
})

async function withFeature(name: string) {
	const user = await users.create(name)
	await db.insert(userFeatures).values({ userId: user.id, feature: "topics" })
	return user
}

/** A reader whose first topics wait to be confirmed: `names`, proposed. */
async function proposal(userId: string, names: string[]) {
	await db.insert(topicLibraries).values({ userId, proposedAt: new Date() })
	const rows = await db
		.insert(topics)
		.values(
			names.map((name) => ({
				userId,
				name,
				description: "d",
				status: "proposed" as const,
				origin: "first" as const,
			})),
		)
		.returning({ id: topics.id })
	return rows.map((row) => row.id)
}

describe("turning topics on and off in the API", () => {
	it("invites a big enough library, turns topics on, and turns them off again", async () => {
		const me = await withFeature("Turning on")
		await insertArticle(me.id, "One", "<p>One.</p>")
		expect(await me.client.topics.list()).toEqual({
			stage: "off",
			items: [],
			progress: { count: 1, needed: 25 },
			invitation: false,
		})
		for (let i = 0; i < 24; i++) await insertArticle(me.id, `More ${i}`, "<p>More.</p>")
		expect(await me.client.topics.list()).toMatchObject({
			progress: { count: 25, needed: 25 },
			invitation: true,
		})

		await me.client.topics.enable()
		expect(await me.client.topics.list()).toEqual({
			stage: "proposing",
			items: [],
			progress: { count: 25, needed: 25 },
		})
		await me.client.topics.disable()
		// Turning them on ended the invitation, for good.
		expect(await me.client.topics.list()).toMatchObject({ stage: "off", invitation: false })
	})

	it("ends the invitation with No thanks", async () => {
		const me = await withFeature("No thanks")
		for (let i = 0; i < 25; i++) await insertArticle(me.id, `Saved ${i}`, "<p>Saved.</p>")
		expect(await me.client.topics.list()).toMatchObject({ invitation: true })
		await me.client.topics.endInvitation()
		expect(await me.client.topics.list()).toMatchObject({ stage: "off", invitation: false })
	})

	it("needs the feature and a server with the models to turn topics on; turning off needs neither", async () => {
		const me = await users.create("No feature")
		expect(await errorOf(me.client.topics.enable())).toMatchObject({
			status: 403,
			code: "forbidden",
		})
		await db.insert(topicLibraries).values({ userId: me.id })
		await me.client.topics.disable()
		const [library] = await db.select().from(topicLibraries).where(eq(topicLibraries.userId, me.id))
		expect(library).toBeUndefined()

		await db.insert(userFeatures).values({ userId: me.id, feature: "topics" })
		const available = vi.spyOn(topicModels, "available", "get").mockReturnValue(false)
		try {
			expect(await errorOf(me.client.topics.enable())).toMatchObject({
				status: 503,
				code: "unavailable",
			})
		} finally {
			available.mockRestore()
		}
	})
})

describe("confirming the first topics in the API", () => {
	it("says Home's card is up until Not now, then keeps the topics kept under their new names", async () => {
		const me = await withFeature("Confirming")
		const [cooking, travel, music] = await proposal(me.id, ["Cooking", "Travel", "Music"])
		expect(await me.client.topics.list()).toMatchObject({ stage: "proposed", card: true })
		await me.client.topics.dismissCard()
		expect(await me.client.topics.list()).toMatchObject({ stage: "proposed", card: false })

		await me.client.topics.confirm([{ id: cooking! }, { id: travel!, name: "  Trips  " }])
		const list = await me.client.topics.list()
		expect(list.stage).toBe("active")
		expect(list.items.map((t) => t.name).sort()).toEqual(["Cooking", "Trips"])
		const [left] = await db.select().from(topics).where(eq(topics.id, music!))
		expect(left?.status).toBe("removed")
		expect(await errorOf(me.client.topics.confirm([]))).toMatchObject({
			status: 409,
			code: "already_done",
		})
	})

	it("refuses two kept topics with one name, and a topic that was not proposed", async () => {
		const me = await withFeature("Two names")
		const other = await withFeature("Other proposal")
		const [cooking, travel] = await proposal(me.id, ["Cooking", "Travel"])
		const [theirs] = await proposal(other.id, ["Theirs"])
		expect(
			await errorOf(me.client.topics.confirm([{ id: cooking! }, { id: travel!, name: "cooking" }])),
		).toMatchObject({ status: 409, code: "name_taken" })
		expect(await errorOf(me.client.topics.confirm([{ id: theirs! }]))).toMatchObject({
			status: 404,
			code: "not_found",
		})
		expect((await me.client.topics.list()).stage).toBe("proposed")
	})

	it("takes the card away once the proposal is opened", async () => {
		const me = await withFeature("Opening")
		await proposal(me.id, ["Cooking"])
		await me.client.topics.seen()
		expect(await me.client.topics.list()).toMatchObject({ stage: "proposed", card: false })
	})
})

describe("correcting topics in the API", () => {
	it("renames a topic, refusing another topic's name whatever its case", async () => {
		const me = await withFeature("Renaming")
		const [growth, writing] = [await topic(me.id, "Growth"), await topic(me.id, "Writing")]
		expect(await me.client.topics.rename(growth, "  Personal   Growth ")).toEqual({
			topic: { id: growth, name: "Personal Growth" },
		})
		expect(await errorOf(me.client.topics.rename(writing, "personal growth"))).toMatchObject({
			status: 409,
			code: "name_taken",
		})
		// The server's own check, past the SDK's.
		const blank = await request(`/api/v1/topics/${writing}`, {
			method: "PATCH",
			token: me.key,
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: " " }),
		})
		expect(blank.status).toBe(400)
		const [row] = await db.select().from(topics).where(eq(topics.id, writing))
		expect(row?.name).toBe("Writing")
	})

	it("removes a topic: its articles leave it", async () => {
		const me = await withFeature("Removing")
		await db
			.insert(topicLibraries)
			.values({ userId: me.id, proposedAt: new Date(), confirmedAt: new Date() })
		const [growth, writing] = [await topic(me.id, "Growth"), await topic(me.id, "Writing")]
		const doc = await insertArticle(me.id, "Draft", "<p>Draft.</p>")
		await place(doc, [[growth, 0.9]])
		expect(await me.client.topics.remove(growth)).toEqual({ topic: { id: growth, name: "Growth" } })
		expect((await me.client.topics.list()).items.map((t) => t.id)).toEqual([writing])
		expect(
			await db.select().from(documentTopics).where(eq(documentTopics.topicId, growth)),
		).toEqual([])
		expect(await errorOf(me.client.topics.remove(growth))).toMatchObject({
			status: 404,
			code: "not_found",
		})
	})

	it("takes an article out of a topic for good", async () => {
		const me = await withFeature("Taking out")
		await db
			.insert(topicLibraries)
			.values({ userId: me.id, proposedAt: new Date(), confirmedAt: new Date() })
		const growth = await topic(me.id, "Growth")
		const [out, stays] = [
			await insertArticle(me.id, "Out", "<p>Out.</p>"),
			await insertArticle(me.id, "Stays", "<p>Stays.</p>"),
		]
		await place(out, [[growth, 0.9]])
		await place(stays, [[growth, 0.9]])
		expect(await me.client.topics.takeOut(growth, out)).toEqual({
			topic: { id: growth, name: "Growth" },
		})
		const page = await me.client.articles.list({ view: "all", topic: growth })
		expect(page.items.map((a) => a.id)).toEqual([stays])
	})

	it("is not_found for another reader's topic or article, and forbidden without the feature", async () => {
		const me = await withFeature("Mine")
		const other = await users.create("Theirs")
		const mine = await topic(me.id, "Mine")
		const theirs = await topic(other.id, "Theirs")
		const theirArticle = await insertArticle(other.id, "Theirs", "<p>Theirs.</p>")
		const trashed = await insertArticle(me.id, "Trashed", "<p>Trashed.</p>")
		await db.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, trashed))
		for (const call of [
			() => me.client.topics.rename(theirs, "Mine now"),
			() => me.client.topics.remove(theirs),
			() => me.client.topics.takeOut(theirs, theirArticle),
			() => me.client.topics.takeOut(mine, theirArticle),
			() => me.client.topics.takeOut(mine, trashed),
		])
			expect(await errorOf(call())).toMatchObject({ status: 404, code: "not_found" })
		// Their topic is as it was.
		const [row] = await db.select().from(topics).where(eq(topics.id, theirs))
		expect(row).toMatchObject({ name: "Theirs", status: "active" })

		for (const call of [
			() => other.client.topics.rename(theirs, "Renamed"),
			() => other.client.topics.remove(theirs),
			() => other.client.topics.seen(),
			() => other.client.topics.countUse("topic_opened"),
		])
			expect(await errorOf(call())).toMatchObject({ status: 403, code: "forbidden" })
	})

	it("counts a use of topics for admins, and only the uses it knows", async () => {
		const me = await withFeature("Counting")
		await me.client.topics.countUse("topic_opened")
		await me.client.topics.countUse("topic_opened")
		const [row] = await db
			.select({ count: usageCounts.count })
			.from(usageCounts)
			.where(
				and(
					eq(usageCounts.userId, me.id),
					eq(usageCounts.metric, "topic_opened"),
					eq(usageCounts.month, monthOf().month),
				),
			)
		expect(row?.count).toBe(2)
		const unknown = await request("/api/v1/topics/use", {
			method: "POST",
			token: me.key,
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ use: "topic_sorts" }),
		})
		expect(unknown.status).toBe(400)
	})
})
