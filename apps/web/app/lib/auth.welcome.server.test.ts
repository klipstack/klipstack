import { createHmac } from "node:crypto"
import { db, eq, user as userTable } from "@klipstack/db"
import { afterAll, describe, expect, it, vi } from "vitest"

// The welcome is on for this file only: the settings are read when the server starts.
vi.hoisted(() => {
	process.env.WELCOME_FROM_NAME = "Ernesto"
	process.env.WELCOME_FROM_EMAIL = "ernesto@example.com"
})
vi.spyOn(console, "log").mockImplementation(() => {})

const { env } = await import("./env.server")
const { auth } = await import("./auth.server")
const { withSignupAllowed } = await import("./signup-gate.server")

const email = `welcome+${Date.now()}@example.com`
const headers = new Headers({
	"x-klipstack-client-ip": email,
	"x-klipstack-client-signature": createHmac("sha256", env.BETTER_AUTH_SECRET)
		.update(email)
		.digest("hex"),
})

afterAll(async () => {
	await db.delete(userTable).where(eq(userTable.email, email))
})

describe("the welcome, while it is on", () => {
	it("is due to an account created now: the note on Home and the email", async () => {
		const signup = await withSignupAllowed(() =>
			auth.api.signUpEmail({
				headers,
				body: { name: "Newcomer", email, password: "password123", locale: "es" },
			}),
		)
		const [row] = await db.select().from(userTable).where(eq(userTable.id, signup.user.id))
		expect(row!.prefs).toEqual({ onboarding: { note: "due", email: "due" } })
		expect(row!.locale).toBe("es")
	})
})
