import { db, documents, eq, user as userTable } from "@klipstack/db"
import { afterAll, describe, expect, it } from "vitest"
import { starterGuide } from "~/lib/starter-texts.server"
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

afterAll(async () => {
	for (const id of users) await db.delete(userTable).where(eq(userTable.id, id))
})

describe("closeWelcome", () => {
	it("ends the note for good and leaves the email to come", async () => {
		const id = await newcomer()
		expect(await closeWelcome(id, { guide: false, language: "en" })).toEqual({ articleId: null })
		expect(await prefsOf(id)).toEqual({ welcomeCardDue: false, welcomeEmailDue: true })
		const saved = await db.select().from(documents).where(eq(documents.userId, id))
		expect(saved).toHaveLength(0)
	})

	it("opens the guide in the reader's language, once, however often it is asked", async () => {
		const id = await newcomer()
		const first = await closeWelcome(id, { guide: true, language: "es" })
		const again = await closeWelcome(id, { guide: true, language: "es" })
		expect(first.articleId).toBeTruthy()
		expect(again.articleId).toBe(first.articleId)
		const [doc] = await db.select().from(documents).where(eq(documents.userId, id))
		expect(doc!.sourceUrl).toBe(starterGuide("es").url)
		expect((await prefsOf(id)).welcomeCardDue).toBe(false)
	})
})
