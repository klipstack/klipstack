import { randomUUID } from "node:crypto"
import { db, eq, inArray, pool, user, type UserPrefs } from "@klipstack/db"
import type { Email } from "@klipstack/email"
import { afterAll, describe, expect, it } from "vitest"
import { handleWelcomeEmail } from "./welcome-email"

// Scoped to this file's rows: a shared development database keeps everyone else's.
const tag = `welcome-${randomUUID().slice(0, 8)}`
const ids: string[] = []
const from = { name: "Ernesto", email: "ernesto@example.com", photo: null }

afterAll(async () => {
	await db.delete(user).where(inArray(user.id, ids))
	await pool.end()
})

async function account(fields: {
	verified: boolean
	prefs: UserPrefs
	name?: string
	locale?: string
}) {
	const id = `${tag}-${ids.length}`
	ids.push(id)
	await db.insert(user).values({
		id,
		name: fields.name ?? "Ada Lovelace",
		email: `${id}@example.com`,
		emailVerified: fields.verified,
		locale: fields.locale ?? "en",
		prefs: fields.prefs,
	})
	return { id, email: `${id}@example.com` }
}

const prefsOf = async (id: string) =>
	(await db.select({ prefs: user.prefs }).from(user).where(eq(user.id, id)))[0]!.prefs

function outbox() {
	const sent: Email[] = []
	return { sent, send: async (email: Email) => void sent.push(email) }
}

describe("handleWelcomeEmail", () => {
	it("welcomes a verified new account once, in its language, with replies to the signer", async () => {
		const reader = await account({
			verified: true,
			prefs: { welcomeEmailDue: true, welcomeCardDue: true },
			locale: "es",
		})
		const mail = outbox()
		await handleWelcomeEmail({ ...mail, from, only: [reader.id] })
		expect(mail.sent).toHaveLength(1)
		const [email] = mail.sent
		expect(email!.to).toBe(reader.email)
		expect(email!.replyTo).toBe("ernesto@example.com")
		expect(email!.subject).toBe("Te damos la bienvenida a Klipstack")
		expect(email!.text).toContain("Te damos la bienvenida a Klipstack, Ada")
		expect(email!.text).toMatch(/\nErnesto\n/)
		expect(email!.text).toContain("/library?save")
		// The note on Home is its own: the email leaves it due.
		expect(await prefsOf(reader.id)).toMatchObject({ welcomeEmailDue: false, welcomeCardDue: true })

		await handleWelcomeEmail({ ...mail, from, only: [reader.id] })
		expect(mail.sent).toHaveLength(1)
	})

	it("waits for the address to be verified", async () => {
		const reader = await account({ verified: false, prefs: { welcomeEmailDue: true } })
		const mail = outbox()
		await handleWelcomeEmail({ ...mail, from, only: [reader.id] })
		expect(mail.sent).toHaveLength(0)
		expect(await prefsOf(reader.id)).toMatchObject({ welcomeEmailDue: true })

		await db.update(user).set({ emailVerified: true }).where(eq(user.id, reader.id))
		await handleWelcomeEmail({ ...mail, from, only: [reader.id] })
		expect(mail.sent.map((email) => email.to)).toEqual([reader.email])
	})

	it("writes to no account created before the welcome, nor without a signer", async () => {
		const older = await account({ verified: true, prefs: {} })
		const due = await account({ verified: true, prefs: { welcomeEmailDue: true } })
		const mail = outbox()
		await handleWelcomeEmail({ ...mail, from: null, only: [older.id, due.id] })
		expect(mail.sent).toHaveLength(0)
		await handleWelcomeEmail({ ...mail, from, only: [older.id, due.id] })
		expect(mail.sent.map((email) => email.to)).toEqual([due.email])
	})

	it("sends at most once, even when the send fails", async () => {
		const reader = await account({ verified: true, prefs: { welcomeEmailDue: true } })
		let tries = 0
		const failing = async () => {
			tries++
			throw new Error("Resend is down")
		}
		expect(await handleWelcomeEmail({ send: failing, from, only: [reader.id] })).toEqual({
			sent: 0,
			failed: 1,
		})
		expect(await handleWelcomeEmail({ send: failing, from, only: [reader.id] })).toEqual({
			sent: 0,
			failed: 0,
		})
		expect(tries).toBe(1)
		expect(await prefsOf(reader.id)).toMatchObject({ welcomeEmailDue: false })
	})
})
