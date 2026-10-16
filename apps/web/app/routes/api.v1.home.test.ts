import {
	db,
	documents,
	documentTopics,
	editions,
	eq,
	readingCompletions,
	topicLibraries,
	topics,
	userFeatures,
} from "@klipstack/db"
import { stopBoss } from "@klipstack/queue"
import type { KlipstackApiError } from "@klipstack/sdk"
import { afterAll, describe, expect, it, vi } from "vitest"
import { startEdition } from "~/commands/editions.server"
import { env } from "~/lib/env.server"
import { apiUsers } from "~/test/api-harness"
import { insertArticle } from "../../e2e/seed"

// Topic models, as on a server with both keys: a topic needs them.
vi.hoisted(() => {
	process.env.AI_FAKE = "1"
})

/**
 * What Home shows beside the library's lists, in /api/v1, through the SDK as the iPhone app calls
 * it, on the real database: what was finished lately, From a while ago, and the next edition.
 */

const origin = new URL(env.APP_URL).origin
const MISSING = "00000000-0000-4000-8000-000000000000"
const users = apiUsers("api-home")
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

const DAY_MS = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY_MS)

async function article(
	owner: string,
	title: string,
	values: Partial<typeof documents.$inferInsert> = {},
) {
	const id = await insertArticle(owner, title, `<p>${title}</p>`)
	if (Object.keys(values).length) await db.update(documents).set(values).where(eq(documents.id, id))
	return id
}

let cycle = 0
const finish = (
	userId: string,
	documentId: string,
	completedAt: Date,
	source: "progress" | "bulk" = "progress",
) =>
	db.insert(readingCompletions).values({ userId, documentId, completedAt, source, cycle: ++cycle })

describe("what was finished lately in the API", () => {
	it("counts the articles read this past week", async () => {
		const me = await users.create("Finished")
		const other = await users.create("Other")
		expect(await me.client.home.finished("Europe/Madrid")).toEqual({ count: 0, title: null })

		const garden = await article(me.id, "Garden")
		await finish(me.id, garden, ago(1))
		// Read twice: one article.
		await finish(me.id, garden, ago(2))
		expect(await me.client.home.finished("Europe/Madrid")).toEqual({ count: 1, title: "Garden" })

		const kitchen = await article(me.id, "Kitchen")
		await finish(me.id, kitchen, ago(3))
		// Not reading: finished several at once, too long ago, or in the trash; nor another's.
		await finish(me.id, await article(me.id, "Tidied"), ago(1), "bulk")
		await finish(me.id, await article(me.id, "Old"), ago(9))
		await finish(me.id, await article(me.id, "Trashed", { deletedAt: new Date() }), ago(1))
		await finish(other.id, await article(other.id, "Theirs"), ago(1))
		expect(await me.client.home.finished("America/New_York")).toEqual({ count: 2, title: null })
		expect(await other.client.home.finished("UTC")).toEqual({ count: 1, title: "Theirs" })
	})

	it("refuses what is no time zone", async () => {
		const me = await users.create("Zone")
		const error = await errorOf(me.client.home.finished("Mars/Olympus_Mons"))
		expect(error.code).toBe("invalid_request")
	})
})

describe("From a while ago in the API", () => {
	it("brings back unread saves from more than 14 days ago, and only those", async () => {
		const me = await users.create("Rediscover")
		const other = await users.create("Other")
		const old = await article(me.id, "Old", { createdAt: ago(20), readingMinutes: 12 })
		const older = await article(me.id, "Older", { createdAt: ago(40) })
		await article(me.id, "New", { createdAt: ago(3) })
		await article(me.id, "Opened", { createdAt: ago(20), firstOpenedAt: ago(2) })
		await article(me.id, "Read", { createdAt: ago(20), readAt: ago(2) })
		await article(me.id, "Archived", { createdAt: ago(20), archivedAt: ago(2) })
		await article(me.id, "Trashed", { createdAt: ago(20), deletedAt: ago(2) })
		await article(me.id, "Queued", { createdAt: ago(20), status: "queued" })
		await article(other.id, "Theirs", { createdAt: ago(20) })

		// The cutoff before the request: the day can't turn under it unseen.
		const today = Date.parse(new Date().toISOString().slice(0, 10))
		const answer = await me.client.home.rediscover()
		expect(answer.items.map((a) => a.id).sort()).toEqual([old, older].sort())
		expect(answer.items.find((a) => a.id === old)).toMatchObject({
			title: "Old",
			readingMinutes: 12,
			readerUrl: `${origin}/read/${old}`,
		})
		// The start of today in UTC, 14 days back: the day's cutoff, the same all day. A run across
		// midnight UTC gets the next day's.
		expect([today, today + DAY_MS].map((t) => new Date(t - 14 * DAY_MS).toISOString())).toContain(
			answer.savedBefore,
		)
		expect(answer.afterDays).toBe(14)
		// The day's order holds through the day.
		expect((await me.client.home.rediscover()).items.map((a) => a.id)).toEqual(
			answer.items.map((a) => a.id),
		)
	})

	it("narrows to the reader's topic, and is not_found for another reader's", async () => {
		const withTopic = async (name: string) => {
			const reader = await users.create(name)
			await db.insert(userFeatures).values({ userId: reader.id, feature: "topics" })
			await db
				.insert(topicLibraries)
				.values({ userId: reader.id, proposedAt: new Date(), confirmedAt: new Date() })
			const [topic] = await db
				.insert(topics)
				.values({ userId: reader.id, name, description: "d", status: "active", origin: "first" })
				.returning({ id: topics.id })
			const inIt = await article(reader.id, `${name} in`, { createdAt: ago(20) })
			await article(reader.id, `${name} out`, { createdAt: ago(20) })
			await db
				.insert(documentTopics)
				.values({ documentId: inIt, topicId: topic!.id, probability: 0.9, level: "applied" })
			return { ...reader, topic: topic!.id, inIt }
		}
		const me = await withTopic("Mine")
		const other = await withTopic("Theirs")
		expect((await me.client.home.rediscover({ topic: me.topic })).items.map((a) => a.id)).toEqual([
			me.inIt,
		])
		for (const topic of [other.topic, MISSING]) {
			const error = await errorOf(me.client.home.rediscover({ topic }))
			expect(error.code).toBe("not_found")
		}
	})
})

describe("the next edition in the API", () => {
	it("counts the articles marked, nudges at three, and says Not now for a week", async () => {
		const me = await users.create("Editions")
		const other = await users.create("Other")
		expect(await me.client.editions.next()).toEqual({
			marked: 0,
			draft: null,
			nudge: null,
			url: `${origin}/editions`,
		})

		const marked = [
			await article(me.id, "One", { shortlistedAt: new Date() }),
			await article(me.id, "Two", { shortlistedAt: new Date() }),
		]
		// In the trash: not marked any more.
		await article(me.id, "Trashed", { shortlistedAt: new Date(), deletedAt: new Date() })
		expect(await me.client.editions.next()).toMatchObject({ marked: 2, draft: null, nudge: null })

		marked.push(await article(me.id, "Three", { shortlistedAt: new Date() }))
		expect(await me.client.editions.next()).toMatchObject({
			marked: 3,
			nudge: { reason: "marked", daysSince: null, readSince: 0 },
		})

		await me.client.editions.snoozeNudge()
		expect(await me.client.editions.next()).toMatchObject({ marked: 3, nudge: null })
		// Another reader's marks and snooze are their own.
		for (const title of ["A", "B", "C"])
			await article(other.id, title, { shortlistedAt: new Date() })
		expect(await other.client.editions.next()).toMatchObject({
			marked: 3,
			nudge: { reason: "marked" },
		})
	})

	it("names the draft in progress, due a week after it was started", async () => {
		const me = await users.create("Draft")
		await article(me.id, "One", { shortlistedAt: new Date() })
		const draft = await startEdition(me.id, { locale: "en", timeZone: "UTC" })
		expect(await me.client.editions.next()).toMatchObject({
			draft: { items: 1, days: 0 },
			nudge: null,
		})
		await db
			.update(editions)
			.set({ createdAt: ago(8) })
			.where(eq(editions.id, draft.id))
		expect(await me.client.editions.next()).toMatchObject({
			draft: { items: 1, days: 8 },
			nudge: { reason: "draft" },
		})
	})
})
