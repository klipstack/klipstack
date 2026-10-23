import { createHmac, randomUUID } from "node:crypto"
import {
	account,
	db,
	eq,
	invites,
	newId,
	oauthClient,
	oauthConsent,
	oauthGrants,
	pool,
	user as userTable,
} from "@klipstack/db"
import { APIError } from "better-auth/api"
import { afterAll, describe, expect, it, vi } from "vitest"
import { env } from "./env.server"
import { listFeatures } from "./features.server"

// The welcome off, whatever the local `.env` says (auth.welcome.server.test.ts has it on).
vi.hoisted(() => {
	process.env.WELCOME_FROM_NAME = ""
	process.env.WELCOME_FROM_EMAIL = ""
})

// Capture console-transport emails instead of printing them.
const logs: string[] = []
vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
	logs.push(args.map(String).join(" "))
})
// And everything else the auth library logs, to check what reaches it.
const errors: string[] = []
for (const method of ["error", "warn"] as const)
	vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
		errors.push(
			args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(" "),
		)
	})

const { auth } = await import("./auth.server")
const { confirmSignupLink, peekMagicLink, requestMagicLink, requestSignupLink } =
	await import("./magic-link.server")
const { createInvite } = await import("./invites.server")
const { requestEmailVerification, verifyEmailToken } = await import("./email-verification.server")
const { withSignupAllowed } = await import("./signup-gate.server")

const email = `magic+${Date.now()}@example.com`
const unverifiedEmail = `reset+${Date.now()}@example.com`
const recoveredEmail = `recovered+${Date.now()}@example.com`
const ownerEmail = `verify-owner+${Date.now()}@example.com`
const strangerEmail = `verify-stranger+${Date.now()}@example.com`
const linkEmail = `signup-link+${Date.now()}@example.com`
const inviteCodes: string[] = []
const testHeaders = new Headers({
	"x-klipstack-client-ip": email,
	"x-klipstack-client-signature": createHmac("sha256", env.BETTER_AUTH_SECRET)
		.update(email)
		.digest("hex"),
})

/** Request a reset for the address and return the token from the emailed link. */
async function emailedResetToken(address: string) {
	const before = logs.length
	await auth.api.requestPasswordReset({
		body: { email: address, redirectTo: "/reset-password" },
		headers: testHeaders,
	})
	const url = /https?:\/\/\S+\/reset-password\/\S+/.exec(logs.slice(before).join("\n"))?.[0]
	expect(url).toBeTruthy()
	// better-auth checks the link, then hands the token to our page.
	const callback = await auth.handler(new Request(url!, { redirect: "manual" }))
	expect([302, 303]).toContain(callback.status)
	const page = new URL(callback.headers.get("location")!)
	expect(page.pathname).toBe("/reset-password")
	return page.searchParams.get("token")!
}

const sessionCookie = (headers: Headers) =>
	new Headers({
		cookie: headers
			.getSetCookie()
			.map((cookie) => cookie.split(";")[0])
			.join("; "),
	})

afterAll(async () => {
	await db.delete(userTable).where(eq(userTable.email, email))
	for (const address of [unverifiedEmail, recoveredEmail, ownerEmail, strangerEmail, linkEmail])
		await db.delete(userTable).where(eq(userTable.email, address))
	for (const code of inviteCodes) await db.delete(invites).where(eq(invites.code, code))
	await pool.end()
})

describe("auth", () => {
	it("refuses to create users outside the invite-checked sign-up", async () => {
		await expect(
			auth.api.signUpEmail({
				headers: testHeaders,
				body: { name: "Gatecrasher", email, password: "password123" },
			}),
		).rejects.toMatchObject({ body: { code: "INVITE_REQUIRED" } })
		const rows = await db.select().from(userTable).where(eq(userTable.email, email))
		expect(rows).toHaveLength(0)
	})

	it("signs up, then logs in through a magic link", async () => {
		const signup = await withSignupAllowed(() =>
			auth.api.signUpEmail({
				headers: testHeaders,
				body: { name: "Magic", email, password: "password123", locale: "es" },
				returnHeaders: true,
			}),
		)
		expect(signup.response.user.email).toBe(email)
		expect(signup.response.user.locale).toBe("es")
		// With the welcome off, no note or email waits for the new account.
		const [row] = await db.select().from(userTable).where(eq(userTable.id, signup.response.user.id))
		expect(row!.prefs).toEqual({})
		// A new account starts with AI and topics turned on; an admin can still turn them off.
		expect(await listFeatures(signup.response.user.id)).toEqual(["ai", "topics"])
		expect(signup.headers.getSetCookie().some((c) => c.startsWith("klip.session_token="))).toBe(
			true,
		)

		await requestMagicLink(email, new Headers({ cookie: "lng=es" }))
		const mail = logs.join("\n")
		expect(mail).toContain("Verifica tu correo de Klipstack")
		const url = /https?:\/\/\S+magic-link\/verify\S+/.exec(mail)?.[0]
		expect(url).toBeTruthy()

		const verify = await auth.handler(new Request(url!, { redirect: "manual" }))
		expect([302, 303]).toContain(verify.status)
		expect(verify.headers.get("location")).toContain("/home")
		const cookies = verify.headers.getSetCookie()
		expect(
			cookies.some((c) => c.startsWith("klip.session_token=") && !c.includes("Max-Age=0")),
		).toBe(true)

		const session = await auth.api.getSession({
			headers: new Headers({ cookie: cookies.map((c) => c.split(";")[0]).join("; ") }),
		})
		expect(session?.user.email).toBe(email)
		const previous = new Headers({
			cookie: signup.headers
				.getSetCookie()
				.map((cookie) => cookie.split(";")[0])
				.join("; "),
		})
		expect(await auth.api.getSession({ headers: previous })).toBeNull()
		await expect(
			auth.api.signInEmail({ body: { email, password: "password123" } }),
		).rejects.toMatchObject({ statusCode: 401 })
	})

	it("sets a new password from an emailed link, once, and signs sessions out", async () => {
		const before = logs.length
		const token = await emailedResetToken(email)
		// The account's language, not the requester's.
		expect(logs.slice(before).join("\n")).toContain("Restablece tu contraseña de Klipstack")
		await auth.api.resetPassword({ body: { token, newPassword: "new-password-1" } })
		await expect(
			auth.api.resetPassword({ body: { token, newPassword: "new-password-2" } }),
		).rejects.toMatchObject({ body: { code: "INVALID_TOKEN" } })

		const login = await auth.api.signInEmail({
			headers: testHeaders,
			body: { email, password: "new-password-1" },
			returnHeaders: true,
		})
		const session = sessionCookie(login.headers)
		expect((await auth.api.getSession({ headers: session }))?.user.email).toBe(email)

		const next = await emailedResetToken(email)
		await auth.api.resetPassword({ body: { token: next, newPassword: "new-password-3" } })
		expect(await auth.api.getSession({ headers: session })).toBeNull()
		await expect(
			auth.api.signInEmail({ headers: testHeaders, body: { email, password: "new-password-1" } }),
		).rejects.toMatchObject({ statusCode: 401 })
	})

	it("ends a verified account's connected apps with a reset", async () => {
		const signup = await withSignupAllowed(() =>
			auth.api.signUpEmail({
				headers: testHeaders,
				body: { name: "Recovered", email: recoveredEmail, password: "password123" },
			}),
		)
		const userId = signup.user.id
		await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.id, userId))
		// What someone with a stolen session could have left behind.
		const clientId = `recovery-client-${Date.now()}`
		await db
			.insert(oauthClient)
			.values({ id: newId(), clientId, name: "Theirs", redirectUris: ["http://127.0.0.1/cb"] })
		await db.insert(oauthConsent).values({ id: newId(), clientId, userId, scopes: ["openid"] })
		await db.insert(oauthGrants).values({ userId, clientId, generation: newId() })

		const token = await emailedResetToken(recoveredEmail)
		await auth.api.resetPassword({ body: { token, newPassword: "recovered-password-1" } })

		expect(await db.select().from(oauthConsent).where(eq(oauthConsent.userId, userId))).toEqual([])
		expect(await db.select().from(oauthGrants).where(eq(oauthGrants.userId, userId))).toEqual([])
		const [owner] = await db.select().from(userTable).where(eq(userTable.id, userId))
		expect(owner?.emailVerified).toBe(true)
		await db.delete(oauthClient).where(eq(oauthClient.clientId, clientId))
	})

	it("treats a reset as mailbox proof for an unverified account", async () => {
		const signup = await withSignupAllowed(() =>
			auth.api.signUpEmail({
				headers: testHeaders,
				body: { name: "Squatter", email: unverifiedEmail, password: "password123" },
				returnHeaders: true,
			}),
		)
		const userId = signup.response.user.id
		await db
			.insert(account)
			.values({ id: newId(), userId, providerId: "github", accountId: "squatter" })

		const token = await emailedResetToken(unverifiedEmail)
		await auth.api.resetPassword({ body: { token, newPassword: "owner-password-1" } })

		const [owner] = await db.select().from(userTable).where(eq(userTable.id, userId))
		expect(owner?.emailVerified).toBe(true)
		const accounts = await db.select().from(account).where(eq(account.userId, userId))
		expect(accounts.map((row) => row.providerId)).toEqual(["credential"])
		expect(await auth.api.getSession({ headers: sessionCookie(signup.headers) })).toBeNull()
		await expect(
			auth.api.signInEmail({
				headers: testHeaders,
				body: { email: unverifiedEmail, password: "password123" },
			}),
		).rejects.toMatchObject({ statusCode: 401 })
		const login = await auth.api.signInEmail({
			headers: testHeaders,
			body: { email: unverifiedEmail, password: "owner-password-1" },
		})
		expect(login.user.emailVerified).toBe(true)
	})

	it("verifies only from a session of the same account, and removes nothing", async () => {
		const signUp = (name: string, address: string) =>
			withSignupAllowed(() =>
				auth.api.signUpEmail({
					headers: testHeaders,
					body: { name, email: address, password: "password123" },
					returnHeaders: true,
				}),
			)
		const owner = sessionCookie((await signUp("Owner", ownerEmail)).headers)
		const stranger = sessionCookie((await signUp("Stranger", strangerEmail)).headers)

		const before = logs.length
		await requestEmailVerification(ownerEmail, owner)
		const mail = logs.slice(before).join("\n")
		const link = /https?:\/\/\S+\/verify-email\?token=\S+/.exec(mail)?.[0]
		expect(link).toBeTruthy()
		// Our page, never better-auth's endpoint, which is closed.
		expect(new URL(link!).pathname).toBe("/verify-email")
		const token = new URL(link!).searchParams.get("token")!
		const verified = async () =>
			(await db.select().from(userTable).where(eq(userTable.email, ownerEmail)))[0]?.emailVerified

		// The mailbox alone, or another account's session, verifies nothing.
		expect(await verifyEmailToken(token, new Headers())).toBe("wrong-account")
		expect(await verifyEmailToken(token, stranger)).toBe("wrong-account")
		expect(await verified()).toBe(false)
		expect(await verifyEmailToken("not-a-token", owner)).toBe("invalid")

		expect(await verifyEmailToken(token, owner)).toBe("verified")
		expect(await verified()).toBe(true)
		expect((await auth.api.getSession({ headers: owner }))?.user.emailVerified).toBe(true)
		const login = await auth.api.signInEmail({
			headers: testHeaders,
			body: { email: ownerEmail, password: "password123" },
		})
		expect(login.user.email).toBe(ownerEmail)
	})

	it("closes better-auth's own verification endpoints", async () => {
		const base = String(auth.options.baseURL)
		const verify = await auth.handler(new Request(new URL("/api/auth/verify-email?token=x", base)))
		expect(verify.status).toBe(404)
		const send = await auth.handler(
			new Request(new URL("/api/auth/send-verification-email", base), {
				method: "POST",
				headers: { "content-type": "application/json", origin: base },
				body: JSON.stringify({ email: strangerEmail }),
			}),
		)
		expect(send.status).toBe(404)
	})

	it("sends no reset mail for unknown emails (no enumeration)", async () => {
		const unknown = `nobody-reset+${Date.now()}@example.com`
		const before = logs.length
		const result = await auth.api.requestPasswordReset({
			body: { email: unknown, redirectTo: "/reset-password" },
			headers: testHeaders,
		})
		expect(result.status).toBe(true)
		expect(logs.slice(before)).toEqual([])
	})

	it("does not create accounts or send mail for unknown emails (no enumeration)", async () => {
		const unknown = `nobody+${Date.now()}@example.com`
		const before = logs.length
		await requestMagicLink(unknown, new Headers())
		expect(logs.slice(before).join("\n")).not.toContain(unknown)
		const rows = await db.select().from(userTable).where(eq(userTable.email, unknown))
		expect(rows).toHaveLength(0)
	})

	it("creates a verified account from a sign-up link, with its invite, once", async () => {
		const inviteCode = await createInvite({ note: "unit" })
		inviteCodes.push(inviteCode)
		const before = logs.length
		await requestSignupLink(
			{ name: "Linked", email: linkEmail, inviteCode, locale: "es" },
			testHeaders,
		)
		const mail = logs.slice(before).join("\n")
		expect(mail).toContain("Crea tu cuenta de Klipstack")
		const link = new URL(/https?:\/\/\S+\/signup\/confirm\?\S+/.exec(mail)![0])
		const token = link.searchParams.get("token")!
		expect(link.searchParams.get("invite")).toBe(inviteCode)
		expect(await peekMagicLink(token)).toBe(linkEmail)

		// A wrong invite creates nothing and leaves the token usable.
		await expect(
			confirmSignupLink({ token, inviteCode: "NOPE", locale: "es" }, testHeaders),
		).rejects.toMatchObject({ body: { code: "INVITE_REQUIRED" } })
		expect(await peekMagicLink(token)).toBe(linkEmail)

		const { response, headers } = await confirmSignupLink(
			{ token, inviteCode, locale: "es" },
			testHeaders,
		)
		expect(headers.getSetCookie().some((c) => c.startsWith("klip.session_token="))).toBe(true)
		const [row] = await db.select().from(userTable).where(eq(userTable.id, response.user.id))
		expect(row).toMatchObject({
			email: linkEmail,
			name: "Linked",
			emailVerified: true,
			locale: "es",
		})
		expect(await listFeatures(row!.id)).toEqual(["ai", "topics"])
		expect(await db.select().from(account).where(eq(account.userId, row!.id))).toHaveLength(0)
		const [invite] = await db.select().from(invites).where(eq(invites.code, inviteCode))
		expect(invite?.usedBy).toBe(row!.id)
		expect(await peekMagicLink(token)).toBeNull()
	})

	it("keeps better-auth's own link endpoint from creating accounts", async () => {
		const address = `signup-direct+${Date.now()}@example.com`
		const inviteCode = await createInvite({ note: "unit" })
		inviteCodes.push(inviteCode)
		const before = logs.length
		await requestSignupLink(
			{ name: "Direct", email: address, inviteCode, locale: "en" },
			testHeaders,
		)
		const token = new URL(
			/https?:\/\/\S+\/signup\/confirm\?\S+/.exec(logs.slice(before).join("\n"))![0],
		).searchParams.get("token")!
		const verify = await auth.handler(
			new Request(new URL(`/api/auth/magic-link/verify?token=${token}`, env.APP_URL), {
				redirect: "manual",
			}),
		)
		expect(verify.headers.getSetCookie().some((c) => c.startsWith("klip.session_token="))).toBe(
			false,
		)
		expect(await db.select().from(userTable).where(eq(userTable.email, address))).toHaveLength(0)
	})
})

/** What Drizzle throws when a query fails: the parameters are in the message. */
const failedQuery = () =>
	Object.assign(
		new Error('Failed query: select * from "session" where "token" = $1\nparams: secret-token'),
		{ cause: Object.assign(new Error("boom secret-token"), { code: "XX000" }) },
	)

describe("auth logs", () => {
	it("reduce errors and arguments before logging", () => {
		errors.length = 0
		auth.options.logger?.log?.("error", "Something failed", failedQuery(), "secret@example.com", {
			email: "secret@example.com",
		})
		expect(errors.join("\n")).toContain("[auth] Something failed")
		expect(errors.join("\n")).toContain("cause.code=XX000")
		expect(errors.join("\n")).not.toContain("secret")
	})

	it("reduce an error passed as the message", () => {
		errors.length = 0
		// better-auth does this in /list-sessions: `logger.error(e)`.
		auth.options.logger?.log?.("error", failedQuery() as unknown as string)
		expect(errors[0]).toMatch(/^\[auth\] Error cause=Error cause.code=XX000\n {4}at /)
		expect(errors.join("\n")).not.toContain("secret")
	})

	it("log failed requests without their messages, and skip ordinary API errors", () => {
		errors.length = 0
		const onError = auth.options.onAPIError?.onError
		onError?.(new APIError("UNAUTHORIZED", { message: "secret@example.com" }))
		expect(errors).toEqual([])
		// Anything else is logged reduced, and answered as a bare 500 (thrown as an API error).
		expect(() => onError?.(failedQuery())).toThrow(APIError)
		expect(errors.join("\n")).toContain("[auth] request failed")
		expect(errors.join("\n")).not.toContain("secret")
	})

	it("log a failed request's code and status", () => {
		errors.length = 0
		auth.options.onAPIError?.onError?.(
			new APIError("INTERNAL_SERVER_ERROR", {
				code: "FAILED_TO_GET_SESSION",
				message: "secret@example.com",
			}),
		)
		// No frames: better-call leaves them out of an API error's stack.
		expect(errors).toEqual([
			"[auth] request failed\nAPIError code=FAILED_TO_GET_SESSION status=500",
		])
	})

	it.each(["/api/auth/sign-in/magic-link", "/api/auth/request-password-reset"])(
		"answer 503 from %s when no email can go out, logging its code only",
		async (path) => {
			errors.length = 0
			const before = logs.length
			vi.stubEnv("NODE_ENV", "production")
			// An address with no account: the answer must not depend on one existing. This run's own,
			// from this run's own client address: the rate limits are stored, and outlive a run.
			const nobody = `nobody-${path.length}-${randomUUID()}@example.com`
			try {
				const res = await auth.handler(
					new Request(new URL(path, auth.options.baseURL), {
						method: "POST",
						headers: {
							"content-type": "application/json",
							origin: String(auth.options.baseURL),
							"x-klipstack-client-ip": nobody,
							"x-klipstack-client-signature": createHmac("sha256", env.BETTER_AUTH_SECRET)
								.update(nobody)
								.digest("hex"),
						},
						body: JSON.stringify({ email: nobody }),
					}),
				)
				expect(res.status).toBe(503)
				expect(await res.json()).toMatchObject({ code: "EMAIL_NOT_CONFIGURED" })
			} finally {
				vi.unstubAllEnvs()
			}
			expect(errors).toHaveLength(1)
			expect(errors[0]).toMatch(
				/^\[auth\] request failed\nEmailError code=EMAIL_NOT_CONFIGURED\n {4}at /,
			)
			expect(logs.slice(before)).toEqual([])
			expect(errors.join("\n")).not.toContain("secret")
		},
	)

	it("keep a real query failure's parameters out of the log", async () => {
		errors.length = 0
		// Postgres refuses NUL bytes in text: the lookup of this token fails with it as a parameter.
		const res = await auth.handler(
			new Request("http://localhost:5180/api/auth/magic-link/verify?token=secret%00token"),
		)
		expect(res.status).toBe(500)
		expect(errors).toHaveLength(1)
		expect(errors[0]).toMatch(/^\[auth\] request failed\nError cause=error cause.code=22021\n/)
		expect(errors.join("\n")).not.toContain("secret")
	})
})
