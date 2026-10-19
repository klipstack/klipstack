import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto"
import {
	API_RESOURCE_PATH,
	MOBILE_CALLBACK_PATH,
	MOBILE_CLIENT_ID,
	MOBILE_REDIRECT_URI,
	MOBILE_SCOPES,
} from "@klipstack/api-contract/auth"
import { db, eq, inArray, invites, user } from "@klipstack/db"
import { RouterContextProvider } from "react-router"
import { afterAll, describe, expect, it, vi } from "vitest"

// The console transport prints emails: capture them to follow the verification link.
const logs: string[] = []
vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
	logs.push(args.map(String).join(" "))
})

// The locale comes from the i18next middleware, which these direct calls skip: English, as a
// visitor without a cookie gets.
vi.mock("~/lib/i18n.server", async (original) => ({
	...(await original<typeof import("~/lib/i18n.server")>()),
	getLocale: () => "en",
}))

const { env } = await import("~/lib/env.server")
const { auth } = await import("~/lib/auth.server")
const { createInvite } = await import("~/lib/invites.server")
const { sessionContext } = await import("~/lib/session.server")
const login = await import("./login")
const signup = await import("./signup")
const verifyEmail = await import("./verify-email")
const oauthVerify = await import("./oauth.verify-email")
const consent = await import("./oauth.consent")

const emails: string[] = []
const codes: string[] = []

afterAll(async () => {
	if (emails.length) await db.delete(user).where(inArray(user.email, emails))
	if (codes.length) await db.delete(invites).where(inArray(invites.code, codes))
})

/** The rate limits key on this signed client address, as the proxy in front of the app sets it. */
const ip = `app-sign-up-${randomUUID()}`
const client = {
	"x-klipstack-client-ip": ip,
	"x-klipstack-client-signature": createHmac("sha256", env.BETTER_AUTH_SECRET)
		.update(ip)
		.digest("hex"),
}

/** Where the provider sends a signed-out reader who starts the iPhone app's sign-in. */
async function appSignIn(redirectUri = MOBILE_REDIRECT_URI) {
	const verifier = randomBytes(32).toString("base64url")
	const response = await auth.handler(
		new Request(
			`${env.APP_URL}/api/auth/oauth2/authorize?${new URLSearchParams({
				response_type: "code",
				client_id: MOBILE_CLIENT_ID,
				redirect_uri: redirectUri,
				scope: MOBILE_SCOPES.join(" "),
				code_challenge: createHash("sha256").update(verifier).digest("base64url"),
				code_challenge_method: "S256",
				state: "app-state",
				resource: `${env.APP_URL}${API_RESOURCE_PATH}`,
				prompt: "consent",
			})}`,
			{ headers: { origin: env.APP_URL }, redirect: "manual" },
		),
	)
	return new URL(response.headers.get("location") ?? "", env.APP_URL)
}

type Cookies = { cookie?: string }

async function contextFor({ cookie }: Cookies) {
	const context = new RouterContextProvider()
	const session = cookie ? await auth.api.getSession({ headers: new Headers({ cookie }) }) : null
	context.set(sessionContext, session ?? null)
	return context
}

async function get(url: URL, route: { loader: (args: never) => unknown }, cookies: Cookies = {}) {
	const request = new Request(url, { headers: { ...client, ...cookies } })
	return route.loader({ request, context: await contextFor(cookies), params: {} } as never)
}

async function post(
	url: URL,
	route: { action: (args: never) => unknown },
	fields: Record<string, string>,
	cookies: Cookies = {},
) {
	const request = new Request(url, {
		method: "POST",
		headers: { origin: env.APP_URL, ...client, ...cookies },
		body: new URLSearchParams(fields),
	})
	return route.action({ request, context: await contextFor(cookies), params: {} } as never)
}

/** The redirect a loader or action throws: where the browser goes next, and the session it sets. */
async function redirected(run: () => Promise<unknown>) {
	try {
		await run()
	} catch (thrown) {
		if (thrown instanceof Response && thrown.headers.has("location")) {
			const set = thrown.headers.getSetCookie().map((c) => c.split(";")[0])
			return {
				to: new URL(thrown.headers.get("location") ?? "", env.APP_URL),
				cookie: set.length ? set.join("; ") : undefined,
			}
		}
		throw thrown
	}
	throw new Error("no redirect")
}

/** The app's sign-in's sign-up page: its address and the request it keeps. */
async function appSignUpPage() {
	const atLogin = await login.loader({
		request: new Request(await appSignIn()),
		context: new RouterContextProvider(),
		params: {},
	} as never)
	const url = new URL(`/signup?${atLogin.appQuery}`, env.APP_URL)
	const page = (await get(url, signup)) as { oauthQuery: string; linkSignup: boolean }
	return { url, page, appQuery: String(atLogin.appQuery) }
}

async function newInvite() {
	const code = await createInvite({ note: "app sign-up test" })
	codes.push(code)
	return code
}

function newEmail(label: string) {
	const email = `${label}-${randomUUID()}@example.com`
	emails.push(email)
	return email
}

describe("the iPhone app's redirect", () => {
	it("may be the universal link or the custom scheme, and nothing else on the server", async () => {
		for (const redirect of [`${env.APP_URL}${MOBILE_CALLBACK_PATH}`, MOBILE_REDIRECT_URI])
			expect((await appSignIn(redirect)).pathname).toBe("/login")
		for (const redirect of [
			`${env.APP_URL}/app/oauth/elsewhere`,
			"https://evil.example/app/oauth/callback",
		]) {
			const refused = await appSignIn(redirect)
			expect(refused.origin).toBe(new URL(env.APP_URL).origin)
			expect(refused.pathname).toBe("/api/auth/error")
			expect(refused.searchParams.get("error")).toBe("invalid_redirect")
			expect(refused.searchParams.has("code")).toBe(false)
		}
	})
})

describe("signing up in the iPhone app's sign-in", () => {
	it("comes back to the app, signed in, once the email is verified", async () => {
		const { url: signupUrl, page } = await appSignUpPage()
		const code = await newInvite()
		const email = newEmail("app-sign-up")

		const before = logs.length
		const signedUp = await redirected(() =>
			post(signupUrl, signup, {
				name: "App Reader",
				email,
				password: "password123",
				inviteCode: code,
				oauthQuery: String((page as { oauthQuery: string }).oauthQuery),
			}),
		)
		// Not the web library: a page in the app's sign-in that waits for the email to be verified.
		expect(signedUp.to.pathname).toBe("/oauth/verify-email")
		expect(signedUp.to.searchParams.get("client_id")).toBe(MOBILE_CLIENT_ID)
		const cookies = { cookie: signedUp.cookie }
		const waiting = await get(signedUp.to, oauthVerify, cookies)
		expect(waiting).toMatchObject({ email, sent: true })
		const [, token] = /\/verify-email\?token=(\S+)/.exec(logs.slice(before).join("\n")) ?? []
		expect(token).toBeTruthy()

		// Continuing before the link is opened stays on the page.
		const tooSoon = await redirected(() =>
			post(signedUp.to, oauthVerify, { intent: "continue" }, cookies),
		)
		expect(tooSoon.to.pathname).toBe("/oauth/verify-email")
		expect(tooSoon.to.searchParams.get("pending")).toBe("1")
		expect(tooSoon.to.searchParams.get("sent")).toBe("1")

		// The emailed link, opened in a browser signed in to the account, verifies it. (On the iPhone
		// it opens in Safari, which may ask for the password first.)
		const verified = await redirected(() =>
			get(new URL(`/verify-email?token=${token}`, env.APP_URL), verifyEmail, cookies),
		)
		expect(verified.to.pathname).toBe("/settings/account")
		expect(verified.to.search).toBe("")

		const resumed = await redirected(() =>
			post(tooSoon.to, oauthVerify, { intent: "continue" }, cookies),
		)
		expect(resumed.to.pathname).toBe("/oauth/consent")
		const allowed = await redirected(() =>
			post(
				resumed.to,
				consent,
				{ intent: "allow", oauthQuery: resumed.to.search.slice(1) },
				cookies,
			),
		)
		expect(`${allowed.to.protocol}${allowed.to.pathname}`).toBe(MOBILE_REDIRECT_URI)
		expect(allowed.to.searchParams.get("state")).toBe("app-state")
		expect(allowed.to.searchParams.get("code")).toBeTruthy()
	})

	it("asks for a password: an emailed sign-up link would open outside the sheet", async () => {
		const { url, page } = await appSignUpPage()
		expect(page).toMatchObject({ linkSignup: false })
		expect(await get(new URL("/signup", env.APP_URL), signup)).toMatchObject({ linkSignup: true })

		const email = newEmail("app-no-password")
		const refused = await post(url, signup, {
			name: "App Reader",
			email,
			inviteCode: await newInvite(),
			oauthQuery: page.oauthQuery,
		})
		expect(refused).toMatchObject({
			init: { status: 400 },
			data: { fieldErrors: { password: "auth:validation.required" } },
		})
		expect(await db.select().from(user).where(eq(user.email, email))).toHaveLength(0)
	})

	it("ends in the web library when the app's request was tampered with", async () => {
		const { url, page } = await appSignUpPage()
		const tampered = page.oauthQuery.replace("app-state", "other-state")
		expect(tampered).not.toBe(page.oauthQuery)
		const inviteCode = await newInvite()
		const signedUp = await redirected(() =>
			post(url, signup, {
				name: "App Reader",
				email: newEmail("app-tampered"),
				password: "password123",
				inviteCode,
				oauthQuery: tampered,
			}),
		)
		expect(signedUp.to.pathname).toBe("/home")
	})

	it("asks to start again from the app once the request expired", async () => {
		const { url, page } = await appSignUpPage()
		const inviteCode = await newInvite()
		const signedUp = await redirected(() =>
			post(url, signup, {
				name: "App Reader",
				email: newEmail("app-expired"),
				password: "password123",
				inviteCode,
				oauthQuery: page.oauthQuery,
			}),
		)
		const cookies = { cookie: signedUp.cookie }
		vi.useFakeTimers({ toFake: ["Date"] })
		vi.setSystemTime(Date.now() + 11 * 60_000)
		try {
			expect(await get(signedUp.to, oauthVerify, cookies)).toMatchObject({ expired: true })
			expect(await post(signedUp.to, oauthVerify, {}, cookies)).toMatchObject({
				init: { status: 400 },
				data: { expired: true },
			})
			// No page of the expired sign-in leads to the web's own sign-in (Google and GitHub) or its
			// library: they end at /login, which says to start again from the app.
			const atLogin = new URL(`/login?${page.oauthQuery}`, env.APP_URL)
			expect(await get(atLogin, login, cookies)).toMatchObject({
				oauthExpired: true,
				appQuery: page.oauthQuery,
			})
			expect(await get(atLogin, login)).toMatchObject({ oauthExpired: true, providers: [] })
			const fromSignUp = await redirected(() => get(url, signup))
			expect(fromSignUp.to.href).toBe(atLogin.href)
			const lateInvite = await newInvite()
			const late = await redirected(() =>
				post(url, signup, {
					name: "App Reader",
					email: newEmail("app-late"),
					password: "password123",
					inviteCode: lateInvite,
					oauthQuery: page.oauthQuery,
				}),
			)
			expect(late.to.href).toBe(atLogin.href)
			const switched = await redirected(() =>
				post(
					new URL("/oauth/consent", env.APP_URL),
					consent,
					{ intent: "switch", oauthQuery: page.oauthQuery },
					cookies,
				),
			)
			expect(switched.to.href).toBe(atLogin.href)
		} finally {
			vi.useRealTimers()
		}
	})

	it("leaves the page for Settings without an app's request", async () => {
		const code = await newInvite()
		const email = newEmail("web-sign-up")
		const web = await redirected(() =>
			post(new URL("/signup", env.APP_URL), signup, {
				name: "Web Reader",
				email,
				password: "password123",
				inviteCode: code,
			}),
		)
		expect(web.to.pathname).toBe("/home")
		const [row] = await db.select().from(user).where(eq(user.email, email))
		expect(row?.emailVerified).toBe(false)
		const away = await redirected(() =>
			get(new URL("/oauth/verify-email", env.APP_URL), oauthVerify, { cookie: web.cookie }),
		)
		expect(away.to.pathname).toBe("/settings/account")

		// Signed in already, the app's sign-up goes back to its sign-in, to continue as this account.
		const { appQuery } = await appSignUpPage()
		const back = await redirected(() =>
			get(new URL(`/signup?${appQuery}`, env.APP_URL), signup, { cookie: web.cookie }),
		)
		expect(back.to.pathname).toBe("/login")
		expect(back.to.searchParams.get("client_id")).toBe(MOBILE_CLIENT_ID)
	})
})
