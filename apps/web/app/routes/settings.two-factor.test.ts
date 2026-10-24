import { createHmac, randomUUID } from "node:crypto"
import { db, eq, inArray, session, user, userFeatures } from "@klipstack/db"
import { RouterContextProvider } from "react-router"
import { afterAll, describe, expect, it } from "vitest"

const { env } = await import("~/lib/env.server")
const { auth } = await import("~/lib/auth.server")
const { sessionContext } = await import("~/lib/session.server")
const { withSignupAllowed } = await import("~/lib/signup-gate.server")
const { action } = await import("./settings.two-factor")

const emails: string[] = []
afterAll(async () => {
	if (emails.length) await db.delete(user).where(inArray(user.email, emails))
})

const PASSWORD = "correct horse battery"

function clientHeaders() {
	const ip = `settings-two-factor-${randomUUID()}`
	return {
		"x-klipstack-client-ip": ip,
		"x-klipstack-client-signature": createHmac("sha256", env.BETTER_AUTH_SECRET)
			.update(ip)
			.digest("hex"),
	}
}

const cookiesOf = (headers: Headers) =>
	headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0])
		.filter((pair) => !pair!.endsWith("="))
		.join("; ")

/** A verified account with the flag, signed in: its id and the session's cookie. */
async function signedIn({ flag = true } = {}) {
	const email = `settings-2fa+${randomUUID()}@example.com`
	emails.push(email)
	const created = await withSignupAllowed(() =>
		auth.api.signUpEmail({
			body: { name: "Reader", email, password: PASSWORD },
			headers: new Headers(clientHeaders()),
			returnHeaders: true,
		}),
	)
	const userId = created.response.user.id
	await db.update(user).set({ emailVerified: true }).where(eq(user.id, userId))
	if (flag) await db.insert(userFeatures).values({ userId, feature: "two-factor" })
	return { userId, email, cookie: cookiesOf(created.headers) }
}

async function post(cookie: string, fields: Record<string, string>) {
	const headers = new Headers({ ...clientHeaders(), cookie })
	const context = new RouterContextProvider()
	context.set(sessionContext, await auth.api.getSession({ headers }))
	try {
		const result = await action({
			request: new Request(`${env.APP_URL}/settings/two-factor`, {
				method: "POST",
				headers,
				body: new URLSearchParams(fields),
			}),
			context,
			params: {},
		} as never)
		// `data(...)` answers carry their headers; plain objects none.
		const answer = result as { data?: { result: string }; init?: ResponseInit; result?: string }
		return {
			result: answer.data?.result ?? answer.result,
			data: (answer.data ?? answer) as Record<string, unknown>,
			headers: new Headers(answer.init?.headers),
		}
	} catch (thrown) {
		return { status: (thrown as { init?: ResponseInit }).init?.status, result: undefined }
	}
}

function base32Decode(text: string): string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
	let bits = ""
	for (const char of text.toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, "0")
	return Buffer.from(bits.match(/.{8}/g)!.map((byte) => Number.parseInt(byte, 2))).toString("utf8")
}

const codeFor = async (key: string) =>
	(await auth.api.generateTOTP({ body: { secret: base32Decode(key) } })).code

const twoFactorOf = async (userId: string) =>
	(await db.select({ on: user.twoFactorEnabled }).from(user).where(eq(user.id, userId)))[0]!.on

describe("Settings → two-factor authentication", () => {
	it("is not offered without the flag", async () => {
		const reader = await signedIn({ flag: false })
		expect(await post(reader.cookie, { intent: "start", password: PASSWORD })).toMatchObject({
			status: 404,
		})
		expect(await twoFactorOf(reader.userId)).toBe(false)
	})

	it("needs the password to start, and the app's code to turn on", async () => {
		const reader = await signedIn()
		expect(
			(await post(reader.cookie, { intent: "start", password: "wrong password" })).result,
		).toBe("wrong-password")

		const started = await post(reader.cookie, { intent: "start", password: PASSWORD })
		expect(started.result).toBe("started")
		expect(String(started.data!.qr)).toMatch(/^data:image\/svg\+xml;base64,/)
		expect(started.data!.backupCodes).toHaveLength(10)
		// Set up, not on: a sign-in asks for no code before the app's first one.
		expect(await twoFactorOf(reader.userId)).toBe(false)

		expect((await post(reader.cookie, { intent: "confirm", code: "000000" })).result).toBe(
			"wrong-code",
		)
		expect(await twoFactorOf(reader.userId)).toBe(false)
	})

	it("turns on with the first code and signs the other sessions out", async () => {
		const reader = await signedIn()
		const elsewhere = await auth.api.signInEmail({
			body: { email: reader.email, password: PASSWORD },
			headers: new Headers(clientHeaders()),
			returnHeaders: true,
		})
		const elsewhereCookie = cookiesOf(elsewhere.headers)
		const started = await post(reader.cookie, { intent: "start", password: PASSWORD })
		const key = String(started.data!.secret)
		const confirmed = await post(reader.cookie, { intent: "confirm", code: await codeFor(key) })
		expect(confirmed.result).toBe("enabled")
		expect(await twoFactorOf(reader.userId)).toBe(true)

		// This browser keeps going, on the session the action answered; the other is over.
		const renewed = cookiesOf(confirmed.headers!)
		expect(
			(await auth.api.getSession({ headers: new Headers({ cookie: renewed }) }))?.user.id,
		).toBe(reader.userId)
		expect(
			await auth.api.getSession({ headers: new Headers({ cookie: elsewhereCookie }) }),
		).toBeNull()
		expect(await db.select().from(session).where(eq(session.userId, reader.userId))).toHaveLength(1)
	})

	it("turns off only with a current code and the password", async () => {
		const reader = await signedIn()
		const started = await post(reader.cookie, { intent: "start", password: PASSWORD })
		const key = String(started.data!.secret)
		const backupCodes = started.data!.backupCodes as string[]
		const confirmed = await post(reader.cookie, { intent: "confirm", code: await codeFor(key) })
		const cookie = cookiesOf(confirmed.headers!)

		expect(
			(await post(cookie, { intent: "disable", password: PASSWORD, code: "000000" })).result,
		).toBe("wrong-code")
		expect(
			(await post(cookie, { intent: "disable", password: "wrong", code: await codeFor(key) }))
				.result,
		).toBe("wrong-password")
		expect(await twoFactorOf(reader.userId)).toBe(true)

		const off = await post(cookie, {
			intent: "disable",
			password: PASSWORD,
			code: backupCodes[0]!,
		})
		expect(off.result).toBe("disabled")
		expect(await twoFactorOf(reader.userId)).toBe(false)
		// A password alone signs in again.
		const again = await auth.api.signInEmail({
			body: { email: reader.email, password: PASSWORD },
			headers: new Headers(clientHeaders()),
		})
		expect("user" in again).toBe(true)
	})

	it("asks an account without a password for a recent sign-in instead", async () => {
		const reader = await signedIn()
		await db
			.update(session)
			.set({ createdAt: new Date(Date.now() - 31 * 60 * 1000) })
			.where(eq(session.userId, reader.userId))
		const { account } = await import("@klipstack/db")
		await db.delete(account).where(eq(account.userId, reader.userId))
		expect((await post(reader.cookie, { intent: "start" })).result).toBe(
			"reauthentication-required",
		)
		await db.update(session).set({ createdAt: new Date() }).where(eq(session.userId, reader.userId))
		expect((await post(reader.cookie, { intent: "start" })).result).toBe("started")
	})
})
