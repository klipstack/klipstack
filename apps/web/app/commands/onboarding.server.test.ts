import { db, documents, eq, user as userTable } from "@klipstack/db"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"
import { rateLimit, SAVE_LIMIT } from "~/lib/rate-limit.server"
import { starterGuide } from "~/lib/starter-texts.server"
import { setPrefs } from "./account.server"
import { closeWelcome, endGettingStarted } from "./onboarding.server"

const stamp = `test-welcome-${Date.now()}`
const users: string[] = []

async function newcomer() {
	const id = `${stamp}-${users.length}`
	users.push(id)
	await db.insert(userTable).values({
		id,
		name: "Newcomer",
		email: `${id}@example.com`,
		prefs: { onboarding: { note: "due", email: "due" } },
	})
	return id
}

const prefsOf = async (id: string) =>
	(await db.select({ prefs: userTable.prefs }).from(userTable).where(eq(userTable.id, id)))[0]!
		.prefs
const savedBy = (id: string) => db.select().from(documents).where(eq(documents.userId, id))

const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/
/** Each call is a day later than the last: a time overwritten shows. */
let day = 0
const tomorrow = () => {
	vi.useFakeTimers({ toFake: ["Date"] })
	vi.setSystemTime(new Date(Date.UTC(2026, 0, ++day)))
	return new Date().toISOString()
}
afterEach(() => vi.useRealTimers())

afterAll(async () => {
	for (const id of users) await db.delete(userTable).where(eq(userTable.id, id))
})

describe("closeWelcome", () => {
	it("ends the note for good and leaves the email to come", async () => {
		const id = await newcomer()
		expect(await closeWelcome(id, { guide: false, locale: "en" })).toEqual({ articleId: null })
		const { onboarding } = await prefsOf(id)
		expect(onboarding?.email).toBe("due")
		expect(onboarding?.note).toMatch(ISO)
		expect(await savedBy(id)).toHaveLength(0)
	})

	it("keeps when it was first closed, and closes nothing for an account it was never shown", async () => {
		const id = await newcomer()
		const first = tomorrow()
		await closeWelcome(id, { guide: false, locale: "en" })
		tomorrow()
		await closeWelcome(id, { guide: true, locale: "en" })
		expect((await prefsOf(id)).onboarding?.note).toBe(first)

		const older = `${stamp}-older`
		users.push(older)
		await db.insert(userTable).values({ id: older, name: "Older", email: `${older}@example.com` })
		await closeWelcome(older, { guide: false, locale: "en" })
		expect((await prefsOf(older)).onboarding).toBeUndefined()
	})

	it("opens the guide in the reader's language, once, however often it is asked", async () => {
		const id = await newcomer()
		const closed = tomorrow()
		const first = await closeWelcome(id, { guide: true, locale: "es" })
		const again = await closeWelcome(id, { guide: true, locale: "es" })
		expect(first.articleId).toBeTruthy()
		expect(again.articleId).toBe(first.articleId)
		const saved = await savedBy(id)
		expect(saved.map((doc) => doc.sourceUrl)).toEqual([starterGuide("es").url])
		expect((await prefsOf(id)).onboarding?.note).toBe(closed)
	})

	it("opens the English guide for a language it is not written in", async () => {
		const id = await newcomer()
		await closeWelcome(id, { guide: true, locale: "fr" })
		expect((await savedBy(id)).map((doc) => doc.sourceUrl)).toEqual([starterGuide("en").url])
	})

	it("keeps the note when the guide cannot be saved, to try again", async () => {
		const id = await newcomer()
		for (let i = 0; i < SAVE_LIMIT.limit; i++)
			rateLimit(`save:${id}`, SAVE_LIMIT.limit, SAVE_LIMIT.windowMs)
		await expect(closeWelcome(id, { guide: true, locale: "en" })).rejects.toMatchObject({
			code: "rate_limited",
		})
		expect((await prefsOf(id)).onboarding?.note).toBe("due")
	})
})

describe("endGettingStarted", () => {
	it("ends the card for good, keeping when it first ended, and the rest", async () => {
		const id = await newcomer()
		const ended = tomorrow()
		await endGettingStarted(id)
		tomorrow()
		await endGettingStarted(id)
		expect((await prefsOf(id)).onboarding).toEqual({
			note: "due",
			email: "due",
			cardEndedAt: ended,
		})
	})
})

describe("onboarding", () => {
	it("is the server's: preferences sent by the reader cannot change it", async () => {
		const id = await newcomer()
		await setPrefs(id, { onboarding: { note: "due", cardEndedAt: "x" }, theme: "dark" } as never)
		expect(await prefsOf(id)).toEqual({ onboarding: { note: "due", email: "due" }, theme: "dark" })
	})

	it("records the first time a feature is turned on, and keeps it when turned off", async () => {
		const id = await newcomer()
		const first = tomorrow()
		await setPrefs(id, { feeds: "on" })
		tomorrow()
		await setPrefs(id, { feeds: "off" })
		await setPrefs(id, { editions: "on" })
		expect((await prefsOf(id)).onboarding).toEqual({
			note: "due",
			email: "due",
			featureOnAt: first,
		})
	})
})
