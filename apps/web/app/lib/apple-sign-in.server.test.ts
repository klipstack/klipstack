import {
	createHash,
	createHmac,
	createPublicKey,
	generateKeyPairSync,
	randomBytes,
	randomUUID,
	sign,
	verify,
} from "node:crypto"
import {
	API_RESOURCE_PATH,
	MOBILE_CLIENT_ID,
	MOBILE_REDIRECT_URI,
} from "@klipstack/api-contract/auth"
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
const { withSignupAllowed } = await import("./signup-gate.server")
const route = await import("~/routes/api.auth")
const appSignInRoute = await import("~/routes/app.sign-in")
const appSignUpRoute = await import("~/routes/app.sign-up")
const { deleteAccount } = await import("~/services/account.server")
const { symmetricDecrypt } = await import("better-auth/crypto")
const { sealAppleToken } = await import("./apple-tokens.server")

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
/** Who the code Apple's sheet gave the app signs in, as Apple's token endpoint answers it. */
let appCodeSubject = subject
/** What the server asked Apple to revoke. */
const revoked: URLSearchParams[] = []
/** Apple's revoke endpoint failing. */
let appleDown = false

vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = String(input instanceof Request ? input.url : input)
	const json = (body: unknown) =>
		new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
	if (url === "https://appleid.apple.com/auth/token") {
		const body = new URLSearchParams(String(init?.body ?? (await (input as Request).text())))
		sentSecrets.push(body.get("client_secret") ?? "")
		if (body.get("client_id") === env.APPLE_BUNDLE_ID)
			return body.get("code") === "app-code"
				? json({
						access_token: "apple-app-access",
						refresh_token: "apple-app-refresh",
						token_type: "Bearer",
						expires_in: 3600,
						id_token: appleIdToken({ aud: env.APPLE_BUNDLE_ID, sub: appCodeSubject }),
					})
				: new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })
		return json({
			access_token: "apple-access",
			refresh_token: "apple-refresh",
			token_type: "Bearer",
			expires_in: 3600,
			id_token: appleIdToken({ aud: env.APPLE_SERVICES_ID }),
		})
	}
	if (url === "https://appleid.apple.com/auth/revoke") {
		revoked.push(new URLSearchParams(String(init?.body)))
		return new Response(null, { status: appleDown ? 503 : 200 })
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

const opened = async (sealed: string | null | undefined) =>
	sealed ? JSON.parse(await symmetricDecrypt({ key: env.BETTER_AUTH_SECRET, data: sealed })) : null

/** The iPhone app's sign-in with Apple's sheet: its nonce, Apple's token and code, its PKCE challenge. */
async function appleFromTheApp(
	claims: Record<string, unknown> = {},
	code = "app-code",
	signUp?: { inviteCode?: string },
) {
	const nonce = randomBytes(16).toString("hex")
	const verifier = randomBytes(32).toString("base64url")
	const headers = clientHeaders()
	headers.set("content-type", "application/json")
	const request = new Request(new URL(signUp ? "/app/sign-up" : "/app/sign-in", env.APP_URL), {
		method: "POST",
		headers,
		body: JSON.stringify({
			method: "apple",
			// The app asks Apple for the SHA-256 of its nonce, and sends the nonce itself.
			idToken: appleIdToken({
				aud: "com.example.reader",
				nonce: createHash("sha256").update(nonce).digest("hex"),
				...claims,
			}),
			nonce,
			authorizationCode: code,
			codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
			...signUp,
		}),
	})
	const target = signUp ? appSignUpRoute : appSignInRoute
	const response = (await target.action(routeArgs(request))) as Response
	return { status: response.status, body: await response.json(), verifier }
}

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
			idToken: null,
		})
		// Apple's refresh token alone is kept, sealed, to revoke the sign-in with the account.
		expect(link!.refreshToken).not.toContain("apple-refresh")
		expect(await opened(link!.refreshToken)).toEqual({
			clientId: "com.example.reader.web",
			refreshToken: "apple-refresh",
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
	it("takes no ID token over HTTP: only /app/sign-in, which exchanges Apple's code", async () => {
		const response = await auth.handler(
			new Request(`${env.APP_URL}/api/auth/sign-in/social`, {
				method: "POST",
				headers: { "content-type": "application/json", origin: env.APP_URL },
				body: JSON.stringify({
					provider: "apple",
					idToken: { token: appleIdToken({ aud: "com.example.reader" }) },
				}),
			}),
		)
		expect(response.status).toBe(404)
	})

	it("lists Apple first among the app's ways in", async () => {
		const response = appSignInRoute.loader() as Response
		expect((await response.json()).providers[0]).toBe("apple")
	})

	it("signs the app in with Apple's sheet, and keeps the app's Apple token", async () => {
		const answer = await appleFromTheApp()
		expect(answer.status).toBe(200)
		const token = await auth.handler(
			new Request(`${env.APP_URL}/api/auth/oauth2/token`, {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					grant_type: "authorization_code",
					code: answer.body.code,
					redirect_uri: MOBILE_REDIRECT_URI,
					client_id: MOBILE_CLIENT_ID,
					code_verifier: answer.verifier,
					resource: `${env.APP_URL}${API_RESOURCE_PATH}`,
				}),
			}),
		)
		expect(token.status).toBe(200)
		const [owner] = await db.select().from(userTable).where(eq(userTable.email, email))
		const [link] = await db.select().from(account).where(eq(account.userId, owner!.id))
		expect(await opened(link!.refreshToken)).toEqual({
			clientId: "com.example.reader",
			refreshToken: "apple-app-refresh",
		})
	})

	it("refuses an ID token whose code Apple doesn't confirm", async () => {
		// A code that does not work (used, expired, made up)...
		const unknown = await appleFromTheApp({}, "used-code")
		expect(unknown.status).toBe(401)
		expect(unknown.body.error).toMatchObject({ code: "unauthorized" })
		// ...or one for someone else: a copied ID token with the thief's own code.
		appCodeSubject = `${subject}-thief`
		try {
			const other = await appleFromTheApp()
			expect(other.status).toBe(401)
		} finally {
			appCodeSubject = subject
		}
	})

	it("refuses a nonce that isn't the one Apple signed", async () => {
		const answer = await appleFromTheApp({ nonce: "another-nonce" })
		expect(answer.status).toBe(401)
	})

	it("creates no account for an unknown Apple ID, even where sign-up is open: not_found", async () => {
		appCodeSubject = `${subject}-new`
		try {
			// As in SIGNUP_MODE=open: only the app's own refusal stands in the way.
			const answer = await withSignupAllowed(() =>
				appleFromTheApp({ sub: `${subject}-new`, email: stranger }),
			)
			expect(answer.status).toBe(404)
			expect(answer.body.error).toMatchObject({ code: "not_found" })
		} finally {
			appCodeSubject = subject
		}
		expect(await db.select().from(userTable).where(eq(userTable.email, stranger))).toHaveLength(0)
		// Apple's sheet authorized the app all the same: that is undone.
		expect(revoked.map((body) => body.get("token"))).toEqual(["apple-app-refresh"])
		revoked.length = 0
	})

	it("signs in no account by email that isn't connected to Apple, and undoes Apple's authorization", async () => {
		// Unverified: better-auth links no provider to it by email.
		const squatted = `apple-unlinked+${randomUUID()}@example.com`
		await db
			.insert(userTable)
			.values({ id: randomUUID(), name: "Unlinked", email: squatted, emailVerified: false })
		appCodeSubject = `${subject}-unlinked`
		try {
			const answer = await appleFromTheApp({ sub: `${subject}-unlinked`, email: squatted })
			expect(answer.status).toBe(403)
			expect(answer.body.error).toMatchObject({ code: "forbidden" })
		} finally {
			appCodeSubject = subject
			await db.delete(userTable).where(eq(userTable.email, squatted))
		}
		expect(revoked.map((body) => body.get("token"))).toEqual(["apple-app-refresh"])
		revoked.length = 0
	})

	it("signs up with Apple's sheet and an invite: a new account, its invite used, Apple's token kept", async () => {
		const inviteCode = await createInvite({ note: "unit" })
		inviteCodes.push(inviteCode)
		const newcomer = `apple-new-${stamp}@privaterelay.appleid.com`
		appCodeSubject = `${subject}-signup`
		try {
			const answer = await appleFromTheApp({ sub: appCodeSubject, email: newcomer }, "app-code", {
				inviteCode,
			})
			expect(answer.status).toBe(200)
			const [created] = await db.select().from(userTable).where(eq(userTable.email, newcomer))
			expect(created).toMatchObject({ emailVerified: true })
			const [used] = await db.select().from(invites).where(eq(invites.code, inviteCode))
			expect(used!.usedBy).toBe(created!.id)
			const [link] = await db.select().from(account).where(eq(account.userId, created!.id))
			expect(link).toMatchObject({ providerId: "apple", accountId: appCodeSubject })
			expect(link!.refreshToken).toBeTruthy()
			await db.delete(userTable).where(eq(userTable.id, created!.id))
		} finally {
			appCodeSubject = subject
		}
		expect(revoked).toHaveLength(0)
	})

	it("refuses Apple's sign-up without an invite it can use, and undoes Apple's authorization", async () => {
		appCodeSubject = `${subject}-no-invite`
		try {
			const answer = await appleFromTheApp({ sub: appCodeSubject, email: stranger }, "app-code", {
				inviteCode: "NOT-AN-INVITE",
			})
			expect(answer.status).toBe(403)
			expect(answer.body.error).toMatchObject({ code: "forbidden" })
		} finally {
			appCodeSubject = subject
		}
		expect(await db.select().from(userTable).where(eq(userTable.email, stranger))).toHaveLength(0)
		expect(revoked.map((body) => body.get("token"))).toEqual(["apple-app-refresh"])
		revoked.length = 0
	})

	it("signs in the account an Apple ID has already, from the sign-up, and leaves the invite unused", async () => {
		const inviteCode = await createInvite({ note: "unit" })
		inviteCodes.push(inviteCode)
		const answer = await appleFromTheApp({}, "app-code", { inviteCode })
		expect(answer.status).toBe(200)
		const [kept] = await db.select().from(invites).where(eq(invites.code, inviteCode))
		expect(kept!.usedBy).toBeNull()
		// An invite used up already changes nothing for an account that exists: no refusal, no revoke.
		const again = await appleFromTheApp({}, "app-code", { inviteCode: "NOT-AN-INVITE" })
		expect(again.status).toBe(200)
		expect(revoked).toHaveLength(0)
	})

	it("revokes the person's Sign in with Apple when the account is deleted", async () => {
		const [owner] = await db.select().from(userTable).where(eq(userTable.email, email))
		await deleteAccount(owner!.id)
		expect(revoked).toHaveLength(1)
		expect(Object.fromEntries(revoked[0]!)).toMatchObject({
			client_id: "com.example.reader",
			token: "apple-app-refresh",
			token_type_hint: "refresh_token",
		})
		const secret = revoked[0]!.get("client_secret")!
		const claims = JSON.parse(Buffer.from(secret.split(".")[1]!, "base64url").toString())
		expect(claims).toMatchObject({ iss: "TEAM123456", sub: "com.example.reader" })
		expect(await db.select().from(userTable).where(eq(userTable.email, email))).toHaveLength(0)
	})

	it("deletes the account even when Apple won't revoke", async () => {
		const other = `apple-down+${randomUUID()}@example.com`
		const [owner] = await db
			.insert(userTable)
			.values({ id: randomUUID(), name: "Apple Down", email: other, emailVerified: true })
			.returning()
		await db.insert(account).values({
			id: randomUUID(),
			userId: owner!.id,
			providerId: "apple",
			accountId: `${subject}-down`,
			refreshToken: await sealAppleToken("com.example.reader", "apple-down-refresh"),
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		appleDown = true
		try {
			await deleteAccount(owner!.id)
		} finally {
			appleDown = false
		}
		expect(revoked.map((body) => body.get("token"))).toContain("apple-down-refresh")
		expect(await db.select().from(userTable).where(eq(userTable.email, other))).toHaveLength(0)
	})
})
