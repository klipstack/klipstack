import { createHmac } from "node:crypto"
import { account, db, eq, inArray, invites, pool, user as userTable } from "@klipstack/db"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

// Credentials make the provider exist. No request reaches GitHub: `fetch` is replaced below.
process.env.GITHUB_CLIENT_ID = "test-client"
process.env.GITHUB_CLIENT_SECRET = "test-secret"

for (const method of ["log", "warn", "error"] as const)
	vi.spyOn(console, method).mockImplementation(() => {})

const { env } = await import("./env.server")
const { auth } = await import("./auth.server")
const { createInvite } = await import("./invites.server")
const { withSignupAllowed } = await import("./signup-gate.server")
const { handleProviderCallback, InvalidInviteError, startProviderSignIn } =
	await import("./provider-sign-in.server")

const stamp = Date.now()
const address = (name: string) => `provider-${name}+${stamp}@example.com`
const emails = ["new", "login", "forged", "squatted", "verified"].map(address)
const inviteCodes: string[] = []

/** What GitHub answers for the account signing in. */
let profile = { id: 1, email: "", verified: true }

vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
	const url = String(input instanceof Request ? input.url : input)
	const json = (body: unknown) =>
		new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
	if (url === "https://github.com/login/oauth/access_token")
		return json({ access_token: "provider-token", token_type: "bearer", scope: "user:email" })
	if (url === "https://api.github.com/user")
		return json({ id: profile.id, login: "octo", name: "Octo Cat", email: profile.email })
	if (url === "https://api.github.com/user/emails")
		return json([{ email: profile.email, primary: true, verified: profile.verified }])
	throw new Error(`unexpected request to ${new URL(url).host}`)
})

const clientHeaders = (extra: Record<string, string> = {}) =>
	new Headers({
		"x-klipstack-client-ip": emails[0]!,
		"x-klipstack-client-signature": createHmac("sha256", env.BETTER_AUTH_SECRET)
			.update(emails[0]!)
			.digest("hex"),
		...extra,
	})

const cookiesOf = (headers: Headers) =>
	headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0])
		.join("; ")

/** The provider's redirect back, as the browser that started `start` would send it. */
async function comeBack(start: Response, cookie = "") {
	expect(start.status).toBe(302)
	const authorize = new URL(start.headers.get("location")!)
	expect(authorize.origin + authorize.pathname).toBe("https://github.com/login/oauth/authorize")
	const callback = new URL("/api/auth/callback/github", env.APP_URL)
	callback.searchParams.set("code", "provider-code")
	callback.searchParams.set("state", authorize.searchParams.get("state")!)
	return handleProviderCallback(
		new Request(callback, {
			headers: clientHeaders({
				cookie: [cookiesOf(start.headers), cookie].filter(Boolean).join("; "),
			}),
		}),
	)
}

const request = () => new Request(new URL("/signup", env.APP_URL), { headers: clientHeaders() })
const usersWith = (email: string) => db.select().from(userTable).where(eq(userTable.email, email))

beforeEach(() => {
	profile = { id: Math.floor(Math.random() * 1e9), email: "", verified: true }
})

afterAll(async () => {
	await db.delete(userTable).where(inArray(userTable.email, emails))
	if (inviteCodes.length) await db.delete(invites).where(inArray(invites.code, inviteCodes))
	await pool.end()
})

describe("provider sign-in", () => {
	it("refuses a sign-up without a usable invite before leaving the site", async () => {
		await expect(
			startProviderSignIn(request(), { provider: "github", signup: true, inviteCode: "NOPE" }),
		).rejects.toBeInstanceOf(InvalidInviteError)
	})

	it("creates the account with its invite, the browser's language and no provider tokens", async () => {
		const inviteCode = await createInvite({ note: "unit" })
		inviteCodes.push(inviteCode)
		profile.email = address("new")
		const start = await startProviderSignIn(request(), {
			provider: "github",
			signup: true,
			inviteCode,
		})
		const done = await comeBack(start, "lng=es")
		expect(done.status).toBe(302)
		expect(done.headers.get("location")).toBe("/home")
		expect(done.headers.getSetCookie().some((c) => c.startsWith("klip.session_token="))).toBe(true)

		const [row] = await usersWith(profile.email)
		expect(row).toMatchObject({ name: "Octo Cat", emailVerified: true, locale: "es" })
		const [invite] = await db.select().from(invites).where(eq(invites.code, inviteCode))
		expect(invite?.usedBy).toBe(row!.id)
		const accounts = await db.select().from(account).where(eq(account.userId, row!.id))
		expect(accounts).toHaveLength(1)
		expect(accounts[0]).toMatchObject({
			providerId: "github",
			accessToken: null,
			refreshToken: null,
			idToken: null,
		})

		// From then on the login button reaches it, with no invite.
		const again = await comeBack(
			await startProviderSignIn(request(), { provider: "github", signup: false }),
		)
		expect(again.headers.get("location")).toBe("/home")
		expect(await usersWith(profile.email)).toHaveLength(1)
		// A login refreshes the link's row: still no tokens.
		const [link] = await db.select().from(account).where(eq(account.userId, row!.id))
		expect(link).toMatchObject({ accessToken: null, refreshToken: null, idToken: null })
	})

	it("creates nothing from the login button", async () => {
		profile.email = address("login")
		const done = await comeBack(
			await startProviderSignIn(request(), { provider: "github", signup: false }),
		)
		const location = new URL(done.headers.get("location")!, env.APP_URL)
		expect(location.pathname).toBe("/login")
		expect(location.searchParams.get("error")).toBe("INVITE_REQUIRED")
		expect(done.headers.getSetCookie().some((c) => c.startsWith("klip.session_token="))).toBe(false)
		expect(await usersWith(profile.email)).toHaveLength(0)
	})

	it("ignores an invite a client puts in the state itself", async () => {
		const inviteCode = await createInvite({ note: "unit" })
		inviteCodes.push(inviteCode)
		profile.email = address("forged")
		const { headers, response } = await auth.api.signInSocial({
			body: {
				provider: "github",
				callbackURL: "/library",
				errorCallbackURL: "/signup",
				requestSignUp: true,
				disableRedirect: true,
				additionalData: { invite: inviteCode, serverContext: { invite: inviteCode } },
			},
			headers: clientHeaders(),
			returnHeaders: true,
		})
		const start = new Response(null, { status: 302, headers })
		start.headers.set("location", response.url!)
		const done = await comeBack(start)
		expect(new URL(done.headers.get("location")!, env.APP_URL).searchParams.get("error")).toBe(
			"INVITE_REQUIRED",
		)
		expect(await usersWith(profile.email)).toHaveLength(0)
		const [invite] = await db.select().from(invites).where(eq(invites.code, inviteCode))
		expect(invite?.usedBy).toBeNull()
	})

	it("does not link a provider to an unverified account with the same address", async () => {
		profile.email = address("squatted")
		await withSignupAllowed(() =>
			auth.api.signUpEmail({
				headers: clientHeaders(),
				body: { name: "Squatter", email: profile.email, password: "password123" },
			}),
		)
		const done = await comeBack(
			await startProviderSignIn(request(), { provider: "github", signup: false }),
		)
		expect(new URL(done.headers.get("location")!, env.APP_URL).searchParams.get("error")).toBe(
			"account_not_linked",
		)
		const [row] = await usersWith(profile.email)
		const accounts = await db.select().from(account).where(eq(account.userId, row!.id))
		expect(accounts.map((a) => a.providerId)).toEqual(["credential"])
	})
	it("links a provider to a verified account with the same address on first login", async () => {
		profile.email = address("verified")
		const signup = await withSignupAllowed(() =>
			auth.api.signUpEmail({
				headers: clientHeaders(),
				body: { name: "Owner", email: profile.email, password: "password123" },
			}),
		)
		await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.id, signup.user.id))
		const done = await comeBack(
			await startProviderSignIn(request(), { provider: "github", signup: false }),
		)
		expect(done.headers.get("location")).toBe("/home")
		const accounts = await db.select().from(account).where(eq(account.userId, signup.user.id))
		expect(accounts.map((a) => a.providerId).sort()).toEqual(["credential", "github"])
		expect((await usersWith(profile.email))[0]?.name).toBe("Owner")
		// A page that sent the visitor to log in gets them back.
		const back = await comeBack(
			await startProviderSignIn(request(), {
				provider: "github",
				signup: false,
				redirectTo: "/settings?tab=1",
			}),
		)
		expect(back.headers.get("location")).toBe("/settings?tab=1")
	})
})
