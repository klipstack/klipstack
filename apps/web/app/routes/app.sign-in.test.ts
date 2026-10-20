import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto"
import {
	API_RESOURCE_PATH,
	MOBILE_CLIENT_ID,
	MOBILE_REDIRECT_URI,
	MOBILE_SCOPES,
} from "@klipstack/api-contract/auth"
import { account, and, db, eq, inArray, invites, session, user } from "@klipstack/db"
import { RouterContextProvider } from "react-router"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

// Credentials make the provider exist. No request reaches GitHub: `fetch` is replaced below.
process.env.GITHUB_CLIENT_ID = "test-client"
process.env.GITHUB_CLIENT_SECRET = "test-secret"

// The console transport prints emails: the codes are read from there.
const logs: string[] = []
vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
	logs.push(args.map(String).join(" "))
})
for (const method of ["warn", "error"] as const)
	vi.spyOn(console, method).mockImplementation(() => {})

const { env } = await import("~/lib/env.server")
const { auth } = await import("~/lib/auth.server")
const { withSignupAllowed } = await import("~/lib/signup-gate.server")
const { handleProviderCallback } = await import("~/lib/provider-sign-in.server")
const signInRoute = await import("./app.sign-in")
const codeRoute = await import("./app.sign-in.code")
const providerRoute = await import("./app.sign-in.provider")
const errorRoute = await import("./app.sign-in.error")

const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
const address = (name: string) => `app-sign-in-${name}+${stamp}@example.com`
const emails = ["reader", "unverified", "github"].map(address)
const PASSWORD = "app-sign-in-password"
const inviteCodes: string[] = []

/** What GitHub answers for the account signing in. */
let profile = { id: 1, email: "" }

vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
	const url = String(input instanceof Request ? input.url : input)
	const json = (body: unknown) =>
		new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
	if (url === "https://github.com/login/oauth/access_token")
		return json({ access_token: "provider-token", token_type: "bearer", scope: "user:email" })
	if (url === "https://api.github.com/user")
		return json({ id: profile.id, login: "octo", name: "Octo Cat", email: profile.email })
	if (url === "https://api.github.com/user/emails")
		return json([{ email: profile.email, primary: true, verified: true }])
	throw new Error(`unexpected request to ${new URL(url).host}`)
})

/** Each test signs in from an address of its own: the limits count per address. */
let ip = `app-sign-in-${randomUUID()}`
beforeEach(() => {
	ip = `app-sign-in-${randomUUID()}`
	profile = { id: Math.floor(Math.random() * 1e9), email: "" }
})
const client = (extra: Record<string, string> = {}) =>
	new Headers({
		"x-klipstack-client-ip": ip,
		"x-klipstack-client-signature": createHmac("sha256", env.BETTER_AUTH_SECRET)
			.update(ip)
			.digest("hex"),
		...extra,
	})

afterAll(async () => {
	await db.delete(user).where(inArray(user.email, emails))
	if (inviteCodes.length) await db.delete(invites).where(inArray(invites.code, inviteCodes))
})

async function createAccount(email: string, { verified }: { verified: boolean }) {
	await withSignupAllowed(() =>
		auth.api.signUpEmail({
			body: { email, password: PASSWORD, name: "Reader" },
			headers: client(),
		}),
	)
	await db.update(user).set({ emailVerified: verified }).where(eq(user.email, email))
}
await createAccount(emails[0]!, { verified: true })
await createAccount(emails[1]!, { verified: false })

const routeArgs = (request: Request, params: Record<string, string> = {}) =>
	({ request, context: new RouterContextProvider(), params }) as never

/** A PKCE pair, as the app makes it. */
function pkce() {
	const verifier = randomBytes(32).toString("base64url")
	return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") }
}

async function post(route: { action: (args: never) => unknown }, path: string, body: unknown) {
	const request = new Request(new URL(path, env.APP_URL), {
		method: "POST",
		headers: client({ "content-type": "application/json" }),
		body: JSON.stringify(body),
	})
	const response = (await route.action(routeArgs(request))) as Response
	const text = await response.text()
	return { status: response.status, body: text ? JSON.parse(text) : null }
}

const signIn = (body: Record<string, unknown>) => post(signInRoute, "/app/sign-in", body)

/** The app's code exchange, at the provider's token endpoint. */
async function exchange(code: string, verifier: string, redirectUri = MOBILE_REDIRECT_URI) {
	const response = await auth.handler(
		new Request(`${env.APP_URL}/api/auth/oauth2/token`, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code,
				redirect_uri: redirectUri,
				client_id: MOBILE_CLIENT_ID,
				code_verifier: verifier,
				resource: `${env.APP_URL}${API_RESOURCE_PATH}`,
			}),
		}),
	)
	return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

async function sessionsOf(email: string) {
	return db
		.select({ id: session.id })
		.from(session)
		.innerJoin(user, eq(user.id, session.userId))
		.where(eq(user.email, email))
}

/** The last code emailed to `email`. */
async function emailedCode(email: string): Promise<string | undefined> {
	await vi.waitFor(() => expect(logs.some((line) => line.includes(email))).toBe(true))
	const mail = logs.findLast((line) => line.includes(email))!
	return /\b(\d{6})\b/.exec(mail)?.[1]
}

describe("the iPhone app's sign-in", () => {
	it("lists the ways in this server offers", async () => {
		const response = signInRoute.loader() as Response
		// No Apple: this server has no Sign in with Apple (apple-sign-in.server.test.ts has one).
		expect(await response.json()).toEqual({ providers: ["github"], emailCode: true })
	})

	it("signs in with a password and gives the app its usual tokens, without a consent screen", async () => {
		const { verifier, challenge } = pkce()
		const before = Date.now()
		const answer = await signIn({
			method: "password",
			email: emails[0],
			password: PASSWORD,
			codeChallenge: challenge,
		})
		expect(answer.status).toBe(200)
		const tokens = await exchange(answer.body.code, verifier)
		expect(tokens.status).toBe(200)
		expect(tokens.body).toMatchObject({
			access_token: expect.any(String),
			refresh_token: expect.any(String),
		})
		// The access token names the new session, which counts as a recent sign-in.
		const claims = JSON.parse(
			Buffer.from(String(tokens.body.access_token).split(".")[1]!, "base64url").toString(),
		)
		expect(claims.azp ?? claims.client_id).toBe(MOBILE_CLIENT_ID)
		const [row] = await db.select().from(session).where(eq(session.id, claims.sid))
		expect(row!.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000)
	})

	it("is a code only the app's verifier redeems", async () => {
		const { challenge } = pkce()
		const answer = await signIn({
			method: "password",
			email: emails[0],
			password: PASSWORD,
			codeChallenge: challenge,
		})
		const tokens = await exchange(answer.body.code, pkce().verifier)
		expect(tokens.status).toBe(401)
		expect(tokens.body.access_token).toBeUndefined()
	})

	it("refuses a wrong password, as unauthorized", async () => {
		const answer = await signIn({
			method: "password",
			email: emails[0],
			password: "not-the-password",
			codeChallenge: pkce().challenge,
		})
		expect(answer.status).toBe(401)
		expect(answer.body.error).toMatchObject({ code: "unauthorized" })
	})

	it("refuses an unverified account's password, and ends the session it started", async () => {
		const before = (await sessionsOf(emails[1]!)).length
		const answer = await signIn({
			method: "password",
			email: emails[1],
			password: PASSWORD,
			codeChallenge: pkce().challenge,
		})
		expect(answer.status).toBe(403)
		expect(answer.body.error).toMatchObject({ code: "verification_required" })
		expect(await sessionsOf(emails[1]!)).toHaveLength(before)
	})

	it("refuses a request without a PKCE challenge", async () => {
		const answer = await signIn({ method: "password", email: emails[0], password: PASSWORD })
		expect(answer.status).toBe(400)
		expect(answer.body.error).toMatchObject({ code: "invalid_request" })
	})

	it("signs in with an emailed code, which works once", async () => {
		const sent = await post(codeRoute, "/app/sign-in/code", { email: emails[0] })
		expect(sent.status).toBe(204)
		const code = await emailedCode(emails[0]!)
		expect(code).toMatch(/^\d{6}$/)

		const { verifier, challenge } = pkce()
		const answer = await signIn({
			method: "code",
			email: emails[0],
			code,
			codeChallenge: challenge,
		})
		expect(answer.status).toBe(200)
		expect((await exchange(answer.body.code, verifier)).status).toBe(200)

		const again = await signIn({
			method: "code",
			email: emails[0],
			code,
			codeChallenge: pkce().challenge,
		})
		expect(again.status).toBe(401)
		expect(again.body.error).toMatchObject({ code: "unauthorized" })
	})

	it("stops a code after three wrong tries", async () => {
		await post(codeRoute, "/app/sign-in/code", { email: emails[0] })
		const code = await emailedCode(emails[0]!)
		const wrong = code === "000000" ? "111111" : "000000"
		for (let i = 0; i < 3; i++) {
			const answer = await signIn({
				method: "code",
				email: emails[0],
				code: wrong,
				codeChallenge: pkce().challenge,
			})
			expect(answer.status).toBe(401)
		}
		const right = await signIn({
			method: "code",
			email: emails[0],
			code,
			codeChallenge: pkce().challenge,
		})
		expect(right.status).toBe(401)
	})

	it("verifies an unverified account with an emailed code, which removes its password", async () => {
		await post(codeRoute, "/app/sign-in/code", { email: emails[1] })
		const code = await emailedCode(emails[1]!)
		const { verifier, challenge } = pkce()
		const answer = await signIn({
			method: "code",
			email: emails[1],
			code,
			codeChallenge: challenge,
		})
		expect(answer.status).toBe(200)
		expect((await exchange(answer.body.code, verifier)).status).toBe(200)
		const [row] = await db.select().from(user).where(eq(user.email, emails[1]!))
		expect(row!.emailVerified).toBe(true)
		const links = await db.select().from(account).where(eq(account.userId, row!.id))
		expect(links.filter((link) => link.providerId === "credential")).toHaveLength(0)
	})

	it("emails nobody without an account, with the same answer", async () => {
		const stranger = address("stranger")
		const sent = await post(codeRoute, "/app/sign-in/code", { email: stranger })
		expect(sent.status).toBe(204)
		await new Promise((resolve) => setTimeout(resolve, 50))
		expect(logs.some((line) => line.includes(stranger))).toBe(false)
		expect(await db.select().from(user).where(eq(user.email, stranger))).toHaveLength(0)
	})

	it("limits the codes sent to one account to 10 a day", async () => {
		const results: number[] = []
		for (let i = 0; i < 11; i++) {
			ip = `app-sign-in-${randomUUID()}`
			results.push((await post(codeRoute, "/app/sign-in/code", { email: emails[2] })).status)
		}
		// Counted per address typed, an account or not, whatever the client address.
		expect(results).toEqual([...Array.from({ length: 10 }, () => 204), 429])
	})

	it("keeps better-auth's own email-code endpoints closed", async () => {
		for (const path of ["/email-otp/send-verification-otp", "/sign-in/email-otp"]) {
			const response = await auth.handler(
				new Request(`${env.APP_URL}/api/auth${path}`, {
					method: "POST",
					headers: { "content-type": "application/json", origin: env.APP_URL },
					body: JSON.stringify({ email: emails[0], type: "sign-in", otp: "123456" }),
				}),
			)
			expect(response.status).toBe(404)
		}
	})
})

describe("Google and GitHub in the app's sign-in sheet", () => {
	/** The app's authorization request, sent to its provider route. */
	function sheetRequest(challenge: string, extra: Record<string, string> = {}) {
		const query = new URLSearchParams({
			response_type: "code",
			client_id: MOBILE_CLIENT_ID,
			redirect_uri: MOBILE_REDIRECT_URI,
			scope: MOBILE_SCOPES.join(" "),
			code_challenge: challenge,
			code_challenge_method: "S256",
			state: "app-state",
			resource: `${env.APP_URL}${API_RESOURCE_PATH}`,
			...extra,
		})
		return new Request(new URL(`/app/sign-in/github?${query}`, env.APP_URL), { headers: client() })
	}

	const cookiesOf = (...responses: Response[]) =>
		responses
			.flatMap((response) => response.headers.getSetCookie())
			.map((cookie) => cookie.split(";")[0])
			.join("; ")

	/** GitHub's redirect back, then each redirect the sheet follows on our server. */
	async function throughGitHub(start: Response) {
		expect(start.status).toBe(302)
		const authorize = new URL(start.headers.get("location")!)
		expect(authorize.origin + authorize.pathname).toBe("https://github.com/login/oauth/authorize")
		const callback = new URL("/api/auth/callback/github", env.APP_URL)
		callback.searchParams.set("code", "provider-code")
		callback.searchParams.set("state", authorize.searchParams.get("state")!)
		const back = await handleProviderCallback(
			new Request(callback, { headers: client({ cookie: cookiesOf(start) }) }),
		)
		expect(back.status).toBe(302)
		const next = new URL(back.headers.get("location")!, env.APP_URL)
		const cookie = cookiesOf(start, back)
		if (next.pathname === "/app/sign-in/error")
			return new URL(
				(
					(await errorRoute.loader(
						routeArgs(new Request(next, { headers: client({ cookie }) })),
					)) as Response
				).headers.get("location")!,
			)
		// On to the app's authorization request, now signed in.
		const done = await auth.handler(
			new Request(next, { headers: client({ cookie }), redirect: "manual" }),
		)
		return new URL(done.headers.get("location")!, env.APP_URL)
	}

	it("signs an account in and comes back to the app with its code", async () => {
		profile.email = emails[0]!
		// The account connected GitHub before, in Settings.
		const [row] = await db.select().from(user).where(eq(user.email, emails[0]!))
		await db.insert(account).values({
			id: `github-${stamp}`,
			userId: row!.id,
			providerId: "github",
			accountId: String(profile.id),
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		const { verifier, challenge } = pkce()
		const start = (await providerRoute.loader(
			routeArgs(sheetRequest(challenge), { provider: "github" }),
		)) as Response
		const back = await throughGitHub(start)
		expect(back.href.startsWith(`${MOBILE_REDIRECT_URI}?`)).toBe(true)
		expect(back.searchParams.get("state")).toBe("app-state")
		const tokens = await exchange(back.searchParams.get("code")!, verifier)
		expect(tokens.status).toBe(200)
		await db
			.delete(account)
			.where(and(eq(account.userId, row!.id), eq(account.providerId, "github")))
	})

	it("comes back to the app with no_account, and creates none, even where sign-up is open", async () => {
		profile.email = emails[2]!
		const start = (await providerRoute.loader(
			routeArgs(sheetRequest(pkce().challenge), { provider: "github" }),
		)) as Response
		// As in SIGNUP_MODE=open: only the app's own refusal stands in the way.
		const back = await withSignupAllowed(() => throughGitHub(start))
		expect(back.href.startsWith(`${MOBILE_REDIRECT_URI}?`)).toBe(true)
		expect(back.searchParams.get("error")).toBe("no_account")
		expect(back.searchParams.get("state")).toBe("app-state")
		expect(await db.select().from(user).where(eq(user.email, emails[2]!))).toHaveLength(0)
	})

	it("takes only the app's own request", async () => {
		const others: Record<string, string>[] = [
			{ client_id: "klipstack-cli" },
			{ redirect_uri: "https://evil.example/callback" },
		]
		for (const extra of others) {
			const response = (await providerRoute.loader(
				routeArgs(sheetRequest(pkce().challenge, extra), { provider: "github" }),
			)) as Response
			expect(response.status).toBe(404)
		}
	})

	it("sends a provider the server doesn't offer back to the app", async () => {
		const response = (await providerRoute.loader(
			routeArgs(sheetRequest(pkce().challenge), { provider: "google" }),
		)) as Response
		const back = new URL(response.headers.get("location")!)
		expect(back.searchParams.get("error")).toBe("failed")
	})
})
