import { createHash, generateKeyPairSync, randomBytes } from "node:crypto"
import {
	API_RESOURCE_PATH,
	CLI_CLIENT_ID,
	CLI_REDIRECT_URI,
	CLI_SCOPES,
	MOBILE_CLIENT_ID,
	MOBILE_REDIRECT_URI,
	MOBILE_SCOPES,
} from "@klipstack/api-contract/auth"
import { makeSignature } from "better-auth/crypto"
import { RouterContextProvider } from "react-router"
import { describe, expect, it } from "vitest"

// GitHub's credentials make it a provider the web offers. No request reaches GitHub.
process.env.GITHUB_CLIENT_ID = "test-client"
process.env.GITHUB_CLIENT_SECRET = "test-secret"
// Apple too: with Sign in with Apple on, the iPhone app's sign-in must still offer none.
process.env.APPLE_TEAM_ID = "TEAM123456"
process.env.APPLE_SERVICES_ID = "com.example.reader.web"
process.env.APPLE_KEY_ID = "KEY1234567"
process.env.APPLE_PRIVATE_KEY = generateKeyPairSync("ec", { namedCurve: "P-256" })
	.privateKey.export({ type: "pkcs8", format: "pem" })
	.toString()

const { env } = await import("~/lib/env.server")
const { auth } = await import("~/lib/auth.server")
const { offeredIn } = await import("~/lib/provider-sign-in.server")
const { formTargetsOf } = await import("~/lib/csp.server")
const login = await import("./login")
const signup = await import("./signup")
const loginCode = await import("./login.code")
const verifyEmail = await import("./oauth.verify-email")
const { sessionContext } = await import("~/lib/session.server")

/**
 * Where the OAuth provider sends a signed-out person who starts this app's sign-in: /login, with
 * the authorization request signed in the query.
 */
async function signInPage(clientId: string, redirectUri: string, scopes: readonly string[]) {
	const verifier = randomBytes(32).toString("base64url")
	const response = await auth.handler(
		new Request(
			`${env.APP_URL}/api/auth/oauth2/authorize?${new URLSearchParams({
				response_type: "code",
				client_id: clientId,
				redirect_uri: redirectUri,
				scope: scopes.join(" "),
				code_challenge: createHash("sha256").update(verifier).digest("base64url"),
				code_challenge_method: "S256",
				state: randomBytes(8).toString("hex"),
				resource: `${env.APP_URL}${API_RESOURCE_PATH}`,
				prompt: "consent",
			})}`,
			{ headers: { origin: env.APP_URL }, redirect: "manual" },
		),
	)
	const location = response.headers.get("location")
	if (!location) throw new Error(`no redirect (${response.status})`)
	const url = new URL(location, env.APP_URL)
	expect(url.pathname).toBe("/login")
	return url
}

/** The app's query as an expired one: re-signed with a past `exp`, as the provider would sign it. */
async function expired(url: URL) {
	const params = new URLSearchParams(url.search)
	params.delete("sig")
	params.set("exp", String(Math.floor(Date.now() / 1000) - 60))
	const sorted = new URLSearchParams(
		[...params].sort(([ka, va], [kb, vb]) =>
			ka === kb ? (va < vb ? -1 : va > vb ? 1 : 0) : ka < kb ? -1 : 1,
		),
	)
	sorted.append("sig", await makeSignature(sorted.toString(), env.BETTER_AUTH_SECRET))
	return new URL(`/login?${sorted}`, env.APP_URL)
}

const at = (path: string, search = "") => new URL(`${path}${search}`, env.APP_URL)

const args = (url: URL, context = new RouterContextProvider()) =>
	({ request: new Request(url), context, params: {} }) as never
const atLoginPage = (url: URL) => login.loader(args(url))
const atSignupPage = (url: URL) => signup.loader(args(url))

/** The origins the page's forms may go on to besides its own (its policy's form-action). */
async function formTargetsAt(page: typeof login | typeof signup, url: URL) {
	const context = new RouterContextProvider()
	await page.loader(args(url, context))
	return formTargetsOf(context)
}

describe("third-party sign-in in an app's sign-in", () => {
	it("is never offered in the iPhone app's: the app offers providers itself", () => {
		expect(offeredIn(MOBILE_CLIENT_ID, ["google", "github"])).toEqual([])
		expect(offeredIn(MOBILE_CLIENT_ID, ["github", "apple"])).toEqual([])
		expect(offeredIn(CLI_CLIENT_ID, ["google", "github"])).toEqual(["google", "github"])
		expect(offeredIn(null, ["github"])).toEqual(["github"])
	})

	it("hides GitHub on the iPhone app's sign-up, which /login links to with its request", async () => {
		const app = await signInPage(MOBILE_CLIENT_ID, MOBILE_REDIRECT_URI, MOBILE_SCOPES)
		const atLogin = await atLoginPage(app)
		expect(atLogin.oauthQuery).toBeTruthy()
		expect(atLogin.providers).toEqual([])
		// Sign up and back to sign in, in the app's sign-in.
		expect(atLogin.appQuery).toBe(atLogin.oauthQuery)
		const atSignup = await atSignupPage(at("/signup", `?${atLogin.appQuery}`))
		expect(atSignup.providers).toEqual([])
		expect(atSignup.appQuery).toBe(atLogin.appQuery)
		expect((await atLoginPage(at("/login", `?${atSignup.appQuery}`))).providers).toEqual([])
	})

	it("hides it when the app's request has expired, and when its signature does not hold", async () => {
		const app = await signInPage(MOBILE_CLIENT_ID, MOBILE_REDIRECT_URI, MOBILE_SCOPES)
		const old = await expired(app)
		const atLogin = await atLoginPage(old)
		expect([atLogin.oauthQuery, atLogin.oauthExpired]).toEqual([null, true])
		expect(atLogin.providers).toEqual([])
		// Sign-up sends an expired request back to that login, which says to start again.
		const fromSignup = await atSignupPage(at("/signup", old.search)).catch((r: Response) => r)
		expect((fromSignup as Response).headers.get("location")).toBe(`/login${old.search}`)

		// Unsigned, it names no app: what the web offers.
		const forged = at("/signup", app.search.replace(/sig=[^&]+/, "sig=forged"))
		expect((await atSignupPage(forged)).providers).toEqual(["apple", "github"])
	})

	it("leaves the web's sign-in, and other apps', as they are", async () => {
		expect((await atLoginPage(at("/login"))).providers).toEqual(["apple", "github"])
		expect((await atSignupPage(at("/signup"))).providers).toEqual(["apple", "github"])
		expect((await atSignupPage(at("/signup"))).appQuery).toBeNull()
		const cli = await signInPage(CLI_CLIENT_ID, CLI_REDIRECT_URI, CLI_SCOPES)
		const atLogin = await atLoginPage(cli)
		expect(atLogin.appQuery).toBeTruthy()
		expect((await atSignupPage(at("/signup", `?${atLogin.appQuery}`))).providers).toEqual([
			"apple",
			"github",
		])
	})
})

describe("where the sign-in pages' forms may go", () => {
	// Until the page hydrates, a form posts as a page load, and form-action also holds the redirect
	// that follows: without these, Chrome would stop the sign-in on this origin.
	it("on the web: the providers its buttons start", async () => {
		const providers = ["https://appleid.apple.com", "https://github.com"]
		expect(await formTargetsAt(login, at("/login"))).toEqual(providers)
		expect(await formTargetsAt(signup, at("/signup"))).toEqual(providers)
	})

	it("in an app's sign-in: that app's redirect URI, and only the providers the page offers", async () => {
		const cli = await signInPage(CLI_CLIENT_ID, "http://127.0.0.1:47123/callback", CLI_SCOPES)
		expect(await formTargetsAt(login, cli)).toEqual(["http://127.0.0.1:47123"])
		const atLogin = await atLoginPage(cli)
		expect(await formTargetsAt(signup, at("/signup", `?${atLogin.appQuery}`))).toEqual([
			"https://appleid.apple.com",
			"https://github.com",
			"http://127.0.0.1:47123",
		])
		const app = await signInPage(MOBILE_CLIENT_ID, MOBILE_REDIRECT_URI, MOBILE_SCOPES)
		expect(await formTargetsAt(login, app)).toEqual(["com.klipstack.app:"])
	})

	it("never an address from a request that does not hold", async () => {
		const cli = await signInPage(CLI_CLIENT_ID, "http://127.0.0.1:47123/callback", CLI_SCOPES)
		const web = ["https://appleid.apple.com", "https://github.com"]
		expect(await formTargetsAt(login, await expired(cli))).toEqual(web)
		const forged = at("/login", cli.search.replace("47123", "47124"))
		expect(await formTargetsAt(login, forged)).toEqual(web)
	})
})

describe("where the pages that finish an app's sign-in let forms go", () => {
	const cliRedirect = "http://127.0.0.1:47123/callback"

	/** The policy's extra origins for a route's loader at `url`, with `cookie` and `signedIn`. */
	async function targetsAt(
		route: typeof loginCode | typeof verifyEmail,
		url: URL,
		{ cookie, signedIn }: { cookie?: string; signedIn?: boolean } = {},
	) {
		const context = new RouterContextProvider()
		if (signedIn)
			context.set(sessionContext, {
				user: { id: "u", email: "reader@example.com", emailVerified: false },
				session: { id: "s", createdAt: new Date() },
			} as never)
		const request = new Request(url, cookie ? { headers: { cookie } } : {})
		await route.loader({ request, context, params: {} } as never)
		return formTargetsOf(context)
	}

	// A pending sign-in from /login's first step (only its presence is read here).
	const pending = { cookie: "klip.two_factor=pending" }

	it("/login/code: the app of the request it finishes", async () => {
		const cli = await signInPage(CLI_CLIENT_ID, cliRedirect, CLI_SCOPES)
		const page = at("/login/code", cli.search)
		expect(await targetsAt(loginCode, page, pending)).toEqual(["http://127.0.0.1:47123"])
		expect(
			await targetsAt(loginCode, at("/login/code", (await expired(cli)).search), pending),
		).toEqual([])
	})

	it("/login/code: the iPhone app, for a provider's sheet that goes on to its request", async () => {
		const authorize = `/api/auth/oauth2/authorize?${new URLSearchParams({
			client_id: MOBILE_CLIENT_ID,
			redirect_uri: MOBILE_REDIRECT_URI,
		})}`
		const page = at("/login/code", `?${new URLSearchParams({ redirectTo: authorize })}`)
		expect(await targetsAt(loginCode, page, pending)).toEqual(["com.klipstack.app:"])
		const other = authorize.replace(
			encodeURIComponent(MOBILE_REDIRECT_URI),
			"https%3A%2F%2Fevil.example%2Fcb",
		)
		expect(
			await targetsAt(
				loginCode,
				at("/login/code", `?${new URLSearchParams({ redirectTo: other })}`),
				pending,
			),
		).toEqual([])
	})

	it("/oauth/verify-email: the app of a request that holds, none of an expired one", async () => {
		const cli = await signInPage(CLI_CLIENT_ID, cliRedirect, CLI_SCOPES)
		const signedIn = { signedIn: true }
		expect(await targetsAt(verifyEmail, at("/oauth/verify-email", cli.search), signedIn)).toEqual([
			"http://127.0.0.1:47123",
		])
		const old = await expired(cli)
		expect(await targetsAt(verifyEmail, at("/oauth/verify-email", old.search), signedIn)).toEqual(
			[],
		)
	})
})
