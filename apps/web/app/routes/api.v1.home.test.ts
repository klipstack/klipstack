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
import { setPrefs } from "~/commands/account.server"
import { startEdition } from "~/commands/editions.server"
import { env } from "~/lib/env.server"
import { apiUsers, request } from "~/test/api-harness"
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

describe("Your reading in the API", () => {
	/**
	 * A fixed zone where it is about noon now, whatever the hour of the run: a minute ago is today
	 * there, and so is this week and month. Never UTC itself, so a handler that ignored the zone
	 * would count other days.
	 */
	function noonZone(now: number) {
		const hour = new Date(now).getUTCHours()
		const offset = hour === 12 ? 1 : 12 - hour
		return { zone: `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`, offset }
	}
	const dayIn = (time: number, timeZone: string) =>
		new Intl.DateTimeFormat("en-CA", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).format(time)

	it("counts what the reader read, as the web's page does", async () => {
		const me = await users.create("Reading")
		const other = await users.create("Other")
		const now = Date.now()
		const { zone } = noonZone(now)
		const today = dayIn(now, zone)
		const none = await me.client.reading.get({ timeZone: zone })
		expect(none.today).toBe(today)
		expect(none.totals).toEqual({
			week: { articles: 0, words: 0, minutes: 0 },
			month: { articles: 0, words: 0, minutes: 0 },
			year: { articles: 0, words: 0, minutes: 0 },
		})
		expect(none.days).toEqual({})
		expect(none.periods).toHaveLength(12)
		expect(none.selected).toMatchObject({ start: none.periods.at(-1)!.start, articles: [] })

		const garden = await article(me.id, "Garden", {
			wordCount: 1200,
			readingMinutes: 5,
			siteName: "example.org",
		})
		// Read twice: one article.
		await finish(me.id, garden, new Date(now - 120_000))
		await finish(me.id, garden, new Date(now - 60_000))
		// Not reading: finished several at once, or in the trash; nor another's, nor one of mine
		// recorded on another reader's article.
		await finish(me.id, await article(me.id, "Tidied", { wordCount: 50 }), new Date(now), "bulk")
		const trashed = await article(me.id, "Trashed", { wordCount: 70, deletedAt: new Date() })
		await finish(me.id, trashed, new Date(now - 60_000))
		await finish(other.id, await article(other.id, "Theirs"), new Date(now - 60_000))
		const notMine = await article(other.id, "Not mine", { wordCount: 90 })
		await finish(me.id, notMine, new Date(now - 60_000))
		// Read 40 days ago: in an earlier month, not in this week's or month's totals.
		const old = await article(me.id, "Old", { wordCount: 300, readingMinutes: 2 })
		const oldAt = now - 40 * DAY_MS
		await finish(me.id, old, new Date(oldAt))
		const oldDay = dayIn(oldAt, zone)

		const stats = await me.client.reading.get({ timeZone: zone })
		const read = { articles: 1, words: 1200, minutes: 5 }
		const year =
			oldDay.slice(0, 4) === today.slice(0, 4) ? { articles: 2, words: 1500, minutes: 7 } : read
		expect(stats.totals).toEqual({ week: read, month: read, year })
		expect(stats.days).toEqual({ [today]: 1, [oldDay]: 1 })
		expect(stats.periods.at(-1)).toEqual({ start: stats.selected.start, ...read })
		expect(stats.selected.articles).toEqual([
			{ id: garden, title: "Garden", siteName: "example.org", words: 1200, minutes: 5, day: today },
		])
		expect((await other.client.reading.get({ timeZone: zone })).totals.week.articles).toBe(1)

		// By month, and an earlier month chosen by its first day.
		const months = await me.client.reading.get({ timeZone: zone, by: "month" })
		expect(months.periods.at(-1)).toEqual({ start: `${today.slice(0, 7)}-01`, ...read })
		expect(months.periods.at(-2)!.start).toMatch(/-01$/)
		const earlier = `${oldDay.slice(0, 7)}-01`
		const [y, m] = earlier.split("-").map(Number)
		const lastDay = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10)
		const before = await me.client.reading.get({ timeZone: zone, by: "month", start: earlier })
		expect(before.selected).toMatchObject({
			start: earlier,
			end: lastDay,
			articles: [{ id: old, title: "Old", siteName: null, words: 300, minutes: 2, day: oldDay }],
		})
	})

	it("counts the reader's days where they are, not in UTC", async () => {
		const me = await users.create("Reading zone")
		const now = Date.now()
		const { zone, offset } = noonZone(now)
		// Half an hour either side of midnight there: two days there, one in UTC.
		const midnight = Math.floor((now + offset * 3_600_000) / DAY_MS) * DAY_MS - offset * 3_600_000
		const late = midnight - 30 * 60_000
		const early = midnight + 30 * 60_000
		await finish(me.id, await article(me.id, "Late"), new Date(late))
		await finish(me.id, await article(me.id, "Early"), new Date(early))
		expect(dayIn(late, zone)).not.toBe(dayIn(early, zone))

		const stats = await me.client.reading.get({ timeZone: zone })
		expect(stats.today).toBe(dayIn(now, zone))
		expect(stats.days).toEqual({ [dayIn(late, zone)]: 1, [dayIn(early, zone)]: 1 })
	})

	it("names the topics read about only for a reader who uses topics", async () => {
		const me = await users.create("Reading topics")
		const { zone } = noonZone(Date.now())
		await db.insert(userFeatures).values({ userId: me.id, feature: "topics" })
		await db
			.insert(topicLibraries)
			.values({ userId: me.id, proposedAt: new Date(), confirmedAt: new Date() })
		const [topic] = await db
			.insert(topics)
			.values({
				userId: me.id,
				name: "Gardens",
				description: "d",
				status: "active",
				origin: "first",
			})
			.returning({ id: topics.id })
		const garden = await article(me.id, "Garden")
		await db
			.insert(documentTopics)
			.values({ documentId: garden, topicId: topic!.id, probability: 0.9, level: "applied" })
		await finish(me.id, garden, new Date(Date.now() - 60_000))
		expect((await me.client.reading.get({ timeZone: zone })).selected.topics).toEqual([
			{ id: topic!.id, name: "Gardens", articles: 1 },
		])

		// The same, without topics in use: none named.
		await db.delete(userFeatures).where(eq(userFeatures.userId, me.id))
		expect((await me.client.reading.get({ timeZone: zone })).selected.topics).toEqual([])
	})

	it("refuses what is no time zone, no way to show it or no day", async () => {
		const me = await users.create("Reading refused")
		const error = await errorOf(me.client.reading.get({ timeZone: "Mars/Olympus_Mons" }))
		expect(error.code).toBe("invalid_request")
		for (const query of ["timeZone=UTC&by=year", "timeZone=UTC&start=2026-1-1", "by=week"]) {
			const answer = await request(`/api/v1/reading?${query}`, { token: me.token })
			expect(answer.status, query).toBe(400)
			expect(await answer.json()).toMatchObject({ error: { code: "invalid_request" } })
		}
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

	it("turned off, has nothing, and refuses marking and edition notes; turned on, it is all there", async () => {
		const me = await users.create("Off", {})
		expect((await me.client.me()).editions).toBe(false)
		const marked = await article(me.id, "Marked before", { shortlistedAt: new Date() })
		expect(await me.client.editions.next()).toEqual({
			marked: 0,
			draft: null,
			nudge: null,
			url: `${origin}/editions`,
		})
		const refusals = [
			() => me.client.articles.update([marked], { shortlisted: false }),
			() => me.client.articles.setEditionNote(marked, "Worth it."),
			() => me.client.editions.snoozeNudge(),
		]
		for (const refused of refusals)
			expect(await errorOf(refused())).toMatchObject({
				status: 403,
				code: "forbidden",
				message: "Editions are turned off for this account.",
			})
		// Nothing was deleted: the mark is there when they are turned on.
		await setPrefs(me.id, { editions: "on" })
		expect((await me.client.me()).editions).toBe(true)
		expect(await me.client.editions.next()).toMatchObject({ marked: 1 })
	})
})
