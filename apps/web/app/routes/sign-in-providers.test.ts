import { createHash, randomBytes } from "node:crypto"
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

const { env } = await import("~/lib/env.server")
const { auth } = await import("~/lib/auth.server")
const { offeredIn } = await import("~/lib/provider-sign-in.server")
const login = await import("./login")
const signup = await import("./signup")

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

const args = (url: URL) =>
	({ request: new Request(url), context: new RouterContextProvider(), params: {} }) as never
const atLoginPage = (url: URL) => login.loader(args(url))
const atSignupPage = (url: URL) => signup.loader(args(url))

describe("third-party sign-in in an app's sign-in", () => {
	it("is offered in the iPhone app's only with Apple among the providers (App Review 4.8)", () => {
		expect(offeredIn(MOBILE_CLIENT_ID, ["google", "github"])).toEqual([])
		expect(offeredIn(MOBILE_CLIENT_ID, ["github", "apple"])).toEqual(["github", "apple"])
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
		expect((await atSignupPage(at("/signup", old.search))).providers).toEqual([])

		// Unsigned, it names no app: what the web offers.
		const forged = at("/signup", app.search.replace(/sig=[^&]+/, "sig=forged"))
		expect((await atSignupPage(forged)).providers).toEqual(["github"])
	})

	it("leaves the web's sign-in, and other apps', as they are", async () => {
		expect((await atLoginPage(at("/login"))).providers).toEqual(["github"])
		expect((await atSignupPage(at("/signup"))).providers).toEqual(["github"])
		expect((await atSignupPage(at("/signup"))).appQuery).toBeNull()
		const cli = await signInPage(CLI_CLIENT_ID, CLI_REDIRECT_URI, CLI_SCOPES)
		const atLogin = await atLoginPage(cli)
		expect(atLogin.appQuery).toBeTruthy()
		expect((await atSignupPage(at("/signup", `?${atLogin.appQuery}`))).providers).toEqual([
			"github",
		])
	})
})
