import { createHmac, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto"
import { account, db, eq, inArray, invites, pool, user as userTable } from "@klipstack/db"
import { RouterContextProvider } from "react-router"
import { afterAll, describe, expect, it, vi } from "vitest"

// Our key at Apple, which signs the client secret, and Apple's own, which signs its ID tokens.
const ours = generateKeyPairSync("ec", { namedCurve: "P-256" })
const apples = generateKeyPairSync("ec", { namedCurve: "P-256" })
process.env.APPLE_TEAM_ID = "TEAM123456"
process.env.APPLE_BUNDLE_ID = "com.example.reader"
process.env.APPLE_SERVICES_ID = "com.example.reader.web"
process.env.APPLE_KEY_ID = "KEY1234567"
// As `.env` holds it: one line, the PEM's line breaks written as \n.
process.env.APPLE_PRIVATE_KEY = (
	ours.privateKey.export({ type: "pkcs8", format: "pem" }) as string
).replaceAll("\n", "\\n")

for (const method of ["log", "warn", "error"] as const)
	vi.spyOn(console, method).mockImplementation(() => {})

const { env, oauth } = await import("./env.server")
const { createInvite } = await import("./invites.server")
const { startProviderSignIn } = await import("./provider-sign-in.server")
const { auth } = await import("./auth.server")
const route = await import("~/routes/api.auth")

const stamp = Date.now()
const email = `apple-${stamp}@privaterelay.appleid.com`
const stranger = `apple-stranger-${stamp}@privaterelay.appleid.com`
const inviteCodes: string[] = []
const subject = `apple-sub-${stamp}`

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")

/** An ID token as Apple signs it. */
function appleIdToken(claims: Record<string, unknown>) {
	const now = Math.floor(Date.now() / 1000)
	const input = `${b64({ alg: "ES256", kid: "apple-kid" })}.${b64({
		iss: "https://appleid.apple.com",
		sub: subject,
		email,
		email_verified: "true",
		is_private_email: "true",
		iat: now,
		exp: now + 600,
		...claims,
	})}`
	const signature = sign("sha256", Buffer.from(input), {
		key: apples.privateKey,
		dsaEncoding: "ieee-p1363",
	})
	return `${input}.${signature.toString("base64url")}`
}

/** The client secrets the server sent to Apple's token endpoint. */
const sentSecrets: string[] = []

vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = String(input instanceof Request ? input.url : input)
	const json = (body: unknown) =>
		new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
	if (url === "https://appleid.apple.com/auth/token") {
		const body = new URLSearchParams(String(init?.body ?? (await (input as Request).text())))
		sentSecrets.push(body.get("client_secret") ?? "")
		return json({
			access_token: "apple-access",
			refresh_token: "apple-refresh",
			token_type: "Bearer",
			expires_in: 3600,
			id_token: appleIdToken({ aud: env.APPLE_SERVICES_ID }),
		})
	}
	if (url === "https://appleid.apple.com/auth/keys")
		return json({
			keys: [{ ...apples.publicKey.export({ format: "jwk" }), kid: "apple-kid", alg: "ES256" }],
		})
	throw new Error(`unexpected request to ${new URL(url).host}`)
})

const cookiesOf = (headers: Headers) =>
	headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0])
		.join("; ")

/** A client address of this run's own, signed as the proxy signs it: the sign-up limit counts per address. */
const clientHeaders = () =>
	new Headers({
		"x-klipstack-client-ip": email,
		"x-klipstack-client-signature": createHmac("sha256", env.BETTER_AUTH_SECRET)
			.update(email)
			.digest("hex"),
	})

const routeArgs = (request: Request) =>
	({ request, context: new RouterContextProvider(), params: {} }) as never

afterAll(async () => {
	await db.delete(userTable).where(inArray(userTable.email, [email, stranger]))
	if (inviteCodes.length) await db.delete(invites).where(inArray(invites.code, inviteCodes))
	await pool.end()
})

describe("Sign in with Apple", () => {
	it("signs up with an invite through Apple's form post, with the name Apple sends once", async () => {
		const inviteCode = await createInvite({ note: "unit" })
		inviteCodes.push(inviteCode)
		const start = await startProviderSignIn(
			new Request(new URL("/signup", env.APP_URL), { headers: clientHeaders() }),
			{
				provider: "apple",
				signup: true,
				inviteCode,
			},
		)
		const authorize = new URL(start.headers.get("location")!)
		expect(authorize.origin + authorize.pathname).toBe("https://appleid.apple.com/auth/authorize")
		expect(authorize.searchParams.get("client_id")).toBe("com.example.reader.web")
		expect(authorize.searchParams.get("response_mode")).toBe("form_post")
		expect(authorize.searchParams.get("redirect_uri")).toBe(
			`${env.APP_URL}/api/auth/callback/apple`,
		)

		// Apple posts the result from its own site. The browser sends no cookie of ours with it
		// (all are SameSite=Lax): the server answers with a redirect to the same URL as a GET.
		const posted = await route.action(
			routeArgs(
				new Request(new URL("/api/auth/callback/apple", env.APP_URL), {
					method: "POST",
					headers: {
						"content-type": "application/x-www-form-urlencoded",
						origin: "https://appleid.apple.com",
						"sec-fetch-site": "cross-site",
						"sec-fetch-mode": "navigate",
					},
					body: new URLSearchParams({
						code: "apple-code",
						state: authorize.searchParams.get("state")!,
						user: JSON.stringify({ name: { firstName: "Ada", lastName: "Lovelace" }, email }),
					}),
				}),
			),
		)
		expect(posted.status).toBe(302)
		const back = new URL(posted.headers.get("location")!, env.APP_URL)
		expect(back.pathname).toBe("/api/auth/callback/apple")

		// That GET carries the cookies again.
		const done = await route.loader(
			routeArgs(new Request(back, { headers: { cookie: cookiesOf(start.headers) } })),
		)
		expect(done.status).toBe(302)
		expect(done.headers.get("location")).toBe("/home")
		expect(done.headers.getSetCookie().some((c) => c.startsWith("klip.session_token="))).toBe(true)

		const [row] = await db.select().from(userTable).where(eq(userTable.email, email))
		expect(row).toMatchObject({ name: "Ada Lovelace", emailVerified: true })
		const [invite] = await db.select().from(invites).where(eq(invites.code, inviteCode))
		expect(invite?.usedBy).toBe(row!.id)
		const [link] = await db.select().from(account).where(eq(account.userId, row!.id))
		expect(link).toMatchObject({
			providerId: "apple",
			accountId: subject,
			accessToken: null,
			refreshToken: null,
			idToken: null,
		})
	})

	it("pays for the code with a client secret signed by our key, as Apple specifies", () => {
		const secret = sentSecrets.at(-1)!
		const [header, payload, signature] = secret.split(".")
		const valid = verify(
			"sha256",
			Buffer.from(`${header}.${payload}`),
			{ key: createPublicKey(ours.privateKey), dsaEncoding: "ieee-p1363" },
			Buffer.from(signature!, "base64url"),
		)
		expect(valid).toBe(true)
		expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({
			alg: "ES256",
			kid: "KEY1234567",
		})
		const claims = JSON.parse(Buffer.from(payload!, "base64url").toString())
		expect(claims).toMatchObject({
			iss: "TEAM123456",
			sub: "com.example.reader.web",
			aud: "https://appleid.apple.com",
		})
		// Apple refuses a secret that lives longer than six months.
		expect(claims.exp - claims.iat).toBeLessThanOrEqual(180 * 24 * 60 * 60)
		expect(claims.exp).toBeGreaterThan(Date.now() / 1000)
	})

	it("renews the client secret before it expires, without a restart", () => {
		const first = oauth.apple!.clientSecret
		vi.useFakeTimers({ now: Date.now() + 2 * 24 * 60 * 60 * 1000, toFake: ["Date"] })
		try {
			const later = oauth.apple!.clientSecret
			const iat = (jwt: string) =>
				JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString()).iat
			expect(iat(later)).toBeGreaterThan(iat(first))
		} finally {
			vi.useRealTimers()
		}
	})

	it("accepts an ID token Apple issued to the iPhone app, for the app's own sign-in", async () => {
		const response = await auth.api.signInSocial({
			body: { provider: "apple", idToken: { token: appleIdToken({ aud: "com.example.reader" }) } },
			headers: new Headers(),
			asResponse: true,
		})
		expect(response.status).toBe(200)
		const body = (await response.json()) as { user?: { email?: string } }
		expect(body.user?.email).toBe(email)
	})

	it("creates no account from an app's ID token without an invite", async () => {
		const response = await auth.api.signInSocial({
			body: {
				provider: "apple",
				idToken: {
					token: appleIdToken({ aud: "com.example.reader", sub: `${subject}-2`, email: stranger }),
				},
			},
			headers: new Headers(),
			asResponse: true,
		})
		expect(response.status).toBe(403)
		expect(await response.json()).toMatchObject({ code: "INVITE_REQUIRED" })
		expect(await db.select().from(userTable).where(eq(userTable.email, stranger))).toHaveLength(0)
	})

	it("refuses an ID token issued to another app", async () => {
		const response = await auth.api.signInSocial({
			body: { provider: "apple", idToken: { token: appleIdToken({ aud: "com.other.app" }) } },
			headers: new Headers(),
			asResponse: true,
		})
		// Refused for its audience, not for a missing invite: the account exists (the first test).
		expect(response.status).toBe(401)
		expect(await response.json()).toMatchObject({ code: "INVALID_TOKEN" })
	})
})
