import { db, documents, eq, user as userTable } from "@klipstack/db"
import { afterAll, describe, expect, it } from "vitest"
import { rateLimit, SAVE_LIMIT } from "~/lib/rate-limit.server"
import { starterGuide } from "~/lib/starter-texts.server"
import { setPrefs } from "./account.server"
import { closeWelcome } from "./welcome.server"

const stamp = `test-welcome-${Date.now()}`
const users: string[] = []

async function newcomer() {
	const id = `${stamp}-${users.length}`
	users.push(id)
	await db.insert(userTable).values({
		id,
		name: "Newcomer",
		email: `${id}@example.com`,
		prefs: { welcomeCardDue: true, welcomeEmailDue: true },
	})
	return id
}

const prefsOf = async (id: string) =>
	(await db.select({ prefs: userTable.prefs }).from(userTable).where(eq(userTable.id, id)))[0]!
		.prefs
const savedBy = (id: string) => db.select().from(documents).where(eq(documents.userId, id))

afterAll(async () => {
	for (const id of users) await db.delete(userTable).where(eq(userTable.id, id))
})

describe("closeWelcome", () => {
	it("ends the note for good and leaves the email to come", async () => {
		const id = await newcomer()
		expect(await closeWelcome(id, { guide: false, locale: "en" })).toEqual({ articleId: null })
		expect(await prefsOf(id)).toEqual({ welcomeCardDue: false, welcomeEmailDue: true })
		expect(await savedBy(id)).toHaveLength(0)
	})

	it("opens the guide in the reader's language, once, however often it is asked", async () => {
		const id = await newcomer()
		const first = await closeWelcome(id, { guide: true, locale: "es" })
		const again = await closeWelcome(id, { guide: true, locale: "es" })
		expect(first.articleId).toBeTruthy()
		expect(again.articleId).toBe(first.articleId)
		const saved = await savedBy(id)
		expect(saved.map((doc) => doc.sourceUrl)).toEqual([starterGuide("es").url])
		expect((await prefsOf(id)).welcomeCardDue).toBe(false)
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
		expect((await prefsOf(id)).welcomeCardDue).toBe(true)
	})
})

describe("the welcome flags", () => {
	it("are the server's: preferences sent by the reader cannot bring them back", async () => {
		const id = await newcomer()
		const over = { welcomeCardDue: false, welcomeEmailDue: false }
		await db.update(userTable).set({ prefs: over }).where(eq(userTable.id, id))
		await setPrefs(id, { welcomeCardDue: true, welcomeEmailDue: true, theme: "dark" } as never)
		expect(await prefsOf(id)).toEqual({ ...over, theme: "dark" })
	})
})
