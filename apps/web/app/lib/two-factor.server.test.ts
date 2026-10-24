import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto"
import {
	API_RESOURCE_PATH,
	MOBILE_CLIENT_ID,
	MOBILE_REDIRECT_URI,
	MOBILE_SCOPES,
} from "@klipstack/api-contract/auth"
import { db, eq, inArray, like, session, user, verification } from "@klipstack/db"
import { afterAll, describe, expect, it, vi } from "vitest"
import { auth } from "./auth.server"
import { env } from "./env.server"
import { oauthApiContext, oauthRedirectUrl, signedOAuthQuery } from "./oauth.server"
import { confirmPassword } from "./session.server"
import { withSignupAllowed } from "./signup-gate.server"
import { completeSignIn, needsSecondStep, pendingSignInSet } from "./two-factor.server"

// The console transport prints emails: the magic link is read from there.
const logs: string[] = []
vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
	logs.push(args.map(String).join(" "))
})

const emails: string[] = []
afterAll(async () => {
	if (emails.length) await db.delete(user).where(inArray(user.email, emails))
})

/** A fresh client address for each test: the auth limits key on it. */
function client() {
	const ip = `two-factor-${randomUUID()}`
	return new Headers({
		"x-klipstack-client-ip": ip,
		"x-klipstack-client-signature": createHmac("sha256", env.BETTER_AUTH_SECRET)
			.update(ip)
			.digest("hex"),
	})
}

const cookiesOf = (headers: Headers) =>
	headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0])
		.filter((pair) => !pair!.endsWith("="))
		.join("; ")

/** A verified account with an authenticator app set up and confirmed: its secret and backup codes. */
async function accountWithTwoFactor() {
	const email = `two-factor+${randomUUID()}@example.com`
	emails.push(email)
	const password = "correct horse battery"
	const signedUp = await withSignupAllowed(() =>
		auth.api.signUpEmail({
			body: { name: "Two Factor", email, password },
			headers: client(),
			returnHeaders: true,
		}),
	)
	await db.update(user).set({ emailVerified: true }).where(eq(user.email, email))
	const signedIn = new Headers(client())
	signedIn.set("cookie", cookiesOf(signedUp.headers))
	const enabled = await auth.api.enableTwoFactor({
		body: { password, method: "totp" },
		headers: signedIn,
	})
	if (enabled.method !== "totp") throw new Error("expected an authenticator app")
	// The URI carries the secret in base32, as authenticator apps read it.
	const secret = base32Decode(new URL(enabled.totpURI!).searchParams.get("secret")!)
	// The first code confirms the app; only then do sign-ins ask for one.
	const { code } = await auth.api.generateTOTP({ body: { secret } })
	await auth.api.verifyTOTP({ body: { code }, headers: signedIn })
	const [row] = await db.select().from(user).where(eq(user.email, email))
	expect(row!.twoFactorEnabled).toBe(true)
	return { email, password, secret, backupCodes: enabled.backupCodes!, userId: row!.id }
}

function base32Decode(text: string): string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
	let bits = ""
	for (const char of text.replace(/=+$/, "").toUpperCase())
		bits += alphabet.indexOf(char).toString(2).padStart(5, "0")
	const bytes = bits.match(/.{8}/g)!.map((byte) => Number.parseInt(byte, 2))
	return Buffer.from(bytes).toString("utf8")
}

/** The OAuth provider's authorization codes issued to the account, unused. */
async function authorizationCodes(userId: string) {
	const rows = await db
		.select({ value: verification.value })
		.from(verification)
		.where(like(verification.value, '%"type":"authorization_code"%'))
	return rows.filter((row) => (JSON.parse(row.value) as { userId?: string }).userId === userId)
}

async function sessionsOf(userId: string) {
	return db.select().from(session).where(eq(session.userId, userId))
}

const codeFor = async (secret: string) => (await auth.api.generateTOTP({ body: { secret } })).code

/** Where the provider sends a signed-out reader who starts the iPhone app's sign-in. */
async function appAuthorization() {
	const verifier = randomBytes(32).toString("base64url")
	const response = await auth.handler(
		new Request(
			`${env.APP_URL}/api/auth/oauth2/authorize?${new URLSearchParams({
				response_type: "code",
				client_id: MOBILE_CLIENT_ID,
				redirect_uri: MOBILE_REDIRECT_URI,
				scope: MOBILE_SCOPES.join(" "),
				code_challenge: createHash("sha256").update(verifier).digest("base64url"),
				code_challenge_method: "S256",
				state: "two-factor-state",
				resource: `${env.APP_URL}${API_RESOURCE_PATH}`,
			})}`,
			{ headers: { origin: env.APP_URL }, redirect: "manual" },
		),
	)
	const query = signedOAuthQuery(new URL(response.headers.get("location") ?? "", env.APP_URL))
	expect(query).toBeTruthy()
	return query!
}

describe("two-factor sign-in", () => {
	it("gives a password no session, only a pending sign-in the code completes", async () => {
		const account = await accountWithTwoFactor()
		const before = (await sessionsOf(account.userId)).length
		const first = await auth.api.signInEmail({
			body: { email: account.email, password: account.password },
			headers: client(),
			returnHeaders: true,
		})
		expect(needsSecondStep(first.response)).toBe(true)
		expect(await sessionsOf(account.userId)).toHaveLength(before)
		const pending = pendingSignInSet(first.headers)
		expect(pending).toBeTruthy()

		const request = new Request(env.APP_URL, { headers: client() })
		expect(await completeSignIn(request, pending!, "000000")).toEqual({ error: "wrong-code" })
		const done = await completeSignIn(request, pending!, await codeFor(account.secret))
		expect("headers" in done).toBe(true)
		const cookie = cookiesOf((done as { headers: Headers }).headers)
		const signedIn = await auth.api.getSession({ headers: new Headers({ cookie }) })
		expect(signedIn?.user.email).toBe(account.email)
		// The pending sign-in is spent: it makes no second session.
		expect(await completeSignIn(request, pending!, await codeFor(account.secret))).toEqual({
			error: "expired",
		})
	})

	it("ends a pending sign-in after 5 wrong codes", async () => {
		const account = await accountWithTwoFactor()
		const first = await auth.api.signInEmail({
			body: { email: account.email, password: account.password },
			headers: client(),
			returnHeaders: true,
		})
		const pending = pendingSignInSet(first.headers)!
		const request = new Request(env.APP_URL, { headers: client() })
		for (let i = 0; i < 5; i++)
			expect(await completeSignIn(request, pending, "000000")).toEqual({ error: "wrong-code" })
		expect(await completeSignIn(request, pending, await codeFor(account.secret))).toEqual({
			error: "expired",
		})
	})

	it("takes a backup code once, typed with or without its dash", async () => {
		const account = await accountWithTwoFactor()
		const [backup] = account.backupCodes
		const signIn = async () =>
			pendingSignInSet(
				(
					await auth.api.signInEmail({
						body: { email: account.email, password: account.password },
						headers: client(),
						returnHeaders: true,
					})
				).headers,
			)!
		const request = new Request(env.APP_URL, { headers: client() })
		const done = await completeSignIn(request, await signIn(), ` ${backup!.replace("-", "")} `)
		expect("headers" in done).toBe(true)
		expect(await completeSignIn(request, await signIn(), backup!)).toEqual({ error: "wrong-code" })
	})

	it("checks the pending sign-in's account, whatever session the browser also holds", async () => {
		const victim = await accountWithTwoFactor()
		const other = await accountWithTwoFactor()
		const otherSession = await auth.api.signInEmail({
			body: { email: other.email, password: other.password },
			headers: client(),
			returnHeaders: true,
		})
		const otherDone = (await completeSignIn(
			new Request(env.APP_URL, { headers: client() }),
			pendingSignInSet(otherSession.headers)!,
			await codeFor(other.secret),
		)) as { headers: Headers }
		const first = await auth.api.signInEmail({
			body: { email: victim.email, password: victim.password },
			headers: client(),
			returnHeaders: true,
		})
		// The browser sends its own session too: the code must still be the victim's.
		const headers = client()
		headers.set("cookie", cookiesOf(otherDone.headers))
		const request = new Request(env.APP_URL, { headers })
		const pending = pendingSignInSet(first.headers)!
		expect(await completeSignIn(request, pending, await codeFor(other.secret))).toEqual({
			error: "wrong-code",
		})
	})

	it("gives an app no authorization before the code, and resumes it after", async () => {
		const account = await accountWithTwoFactor()
		const oauthQuery = await appAuthorization()
		const request = new Request(`${env.APP_URL}/login`, { headers: client() })
		// As /login sends it: the provider's hooks read `oauth_query` from the body.
		const body = { email: account.email, password: account.password, oauth_query: oauthQuery }
		const first = await auth.api.signInEmail({
			body,
			...oauthApiContext(request),
			returnHeaders: true,
		})
		expect(needsSecondStep(first.response)).toBe(true)
		expect(JSON.stringify(first.response)).not.toContain("code=")
		expect(oauthRedirectUrl(first.response)).toBeNull()
		// Not even one kept back: the provider issued no code for the password's session.
		expect(await authorizationCodes(account.userId)).toHaveLength(0)

		const done = await completeSignIn(
			request,
			pendingSignInSet(first.headers)!,
			await codeFor(account.secret),
			oauthQuery,
		)
		expect("response" in done).toBe(true)
		const next = new URL(oauthRedirectUrl((done as { response: unknown }).response)!)
		expect(next.href.split("?")[0]).toBe(MOBILE_REDIRECT_URI)
		expect(next.searchParams.get("state")).toBe("two-factor-state")
		expect(next.searchParams.get("code")).toBeTruthy()
		expect(await authorizationCodes(account.userId)).toHaveLength(1)
	})

	it("asks a password confirmation for the code too, keeping the session until it is right", async () => {
		const account = await accountWithTwoFactor()
		const first = await auth.api.signInEmail({
			body: { email: account.email, password: account.password },
			headers: client(),
			returnHeaders: true,
		})
		const done = (await completeSignIn(
			new Request(env.APP_URL, { headers: client() }),
			pendingSignInSet(first.headers)!,
			await codeFor(account.secret),
		)) as { headers: Headers }
		const headers = client()
		headers.set("cookie", cookiesOf(done.headers))
		const request = new Request(env.APP_URL, { headers })
		const current = (await auth.api.getSession({ headers }))!
		const stillSignedIn = async () =>
			(await sessionsOf(account.userId)).some((row) => row.id === current.session.id)

		expect(await confirmPassword(request, current, account.password)).toEqual({
			error: "code-required",
		})
		expect(await stillSignedIn()).toBe(true)
		expect(await confirmPassword(request, current, account.password, "000000")).toEqual({
			error: "wrong-code",
		})
		expect(await stillSignedIn()).toBe(true)
		expect(await confirmPassword(request, current, "wrong password", "000000")).toEqual({
			error: "wrong-password",
		})

		const confirmed = await confirmPassword(
			request,
			current,
			account.password,
			await codeFor(account.secret),
		)
		expect("headers" in confirmed).toBe(true)
		expect(await stillSignedIn()).toBe(false)
		const renewed = await auth.api.getSession({
			headers: new Headers({ cookie: cookiesOf((confirmed as { headers: Headers }).headers) }),
		})
		expect(renewed?.user.id).toBe(account.userId)
	})

	it("stops a magic link at the code too, then goes where the link was going", async () => {
		const account = await accountWithTwoFactor()
		const before = logs.length
		await auth.api.signInMagicLink({
			body: { email: account.email, callbackURL: "/library?view=all" },
			headers: client(),
		})
		await vi.waitFor(() => {
			expect(logs.slice(before).join("\n")).toMatch(/magic-link\/verify\?token=/)
		})
		const link = /https?:\/\/\S+magic-link\/verify\?\S+/.exec(logs.slice(before).join("\n"))![0]
		const sessionsBefore = (await sessionsOf(account.userId)).length
		const opened = await auth.handler(new Request(link, { headers: client(), redirect: "manual" }))
		expect(opened.status).toBe(302)
		const location = new URL(opened.headers.get("location")!, env.APP_URL)
		expect(location.pathname).toBe("/login/code")
		expect(location.searchParams.get("redirectTo")).toBe("/library?view=all")
		// No session reached the browser, and none is left behind.
		expect(opened.headers.getSetCookie().filter((c) => /session_token=[^;]/.test(c))).toHaveLength(
			0,
		)
		expect(await sessionsOf(account.userId)).toHaveLength(sessionsBefore)

		const pending = pendingSignInSet(opened.headers)
		expect(pending).toBeTruthy()
		const done = await completeSignIn(
			new Request(env.APP_URL, { headers: client() }),
			pending!,
			await codeFor(account.secret),
		)
		expect("headers" in done).toBe(true)
	})

	it("closes the plugin's endpoints over HTTP", async () => {
		// Every one of the plugin's: Settings and the sign-in pages are the only ways to them.
		for (const path of [
			"/two-factor/enable",
			"/two-factor/disable",
			"/two-factor/get-totp-uri",
			"/two-factor/verify-totp",
			"/two-factor/send-otp",
			"/two-factor/verify-otp",
			"/two-factor/verify-backup-code",
			"/two-factor/generate-backup-codes",
			"/two-factor/view-backup-codes",
		]) {
			const response = await auth.handler(
				new Request(`${env.APP_URL}/api/auth${path}`, {
					method: "POST",
					headers: { "content-type": "application/json", origin: env.APP_URL },
					body: JSON.stringify({ code: "000000", password: "x" }),
				}),
			)
			expect(response.status).toBe(404)
		}
	})
})
