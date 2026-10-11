import { createHmac, randomUUID } from "node:crypto"
import {
	db,
	eq,
	inArray,
	newId,
	oauthClient,
	oauthConsent,
	oauthGrants,
	user as userTable,
} from "@klipstack/db"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

const { auth, API_RESOURCE, MCP_RESOURCE } = await import("~/lib/auth.server")
const { authenticateApiRequest } = await import("./auth.server")
const { ApiError } = await import("./errors.server")
const { env, selfUrl } = await import("~/lib/env.server")
const { BAD_BEARER_LIMIT } = await import("~/lib/rate-limit.server")

// The verifier fetches our key set over HTTP from the app's own address, where no server listens
// in a unit test. This stands in for that network hop: the same request goes to the auth handler
// in-process, so tokens are checked against the real keys. `jwksDown` answers 503 instead.
const jwksUrl = `${selfUrl}/api/auth/jwks`
let jwksDown = false
const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
	const request = new Request(input, init)
	if (request.url !== jwksUrl) throw new Error(`Unexpected fetch: ${request.url}`)
	if (jwksDown) return new Response("", { status: 503, statusText: "Service Unavailable" })
	return auth.handler(request)
})

const tag = randomUUID()
const userId = `test-api-auth-${tag}`
const clientIds: string[] = []

beforeAll(async () => {
	await db
		.insert(userTable)
		.values({ id: userId, name: "API auth", email: `${userId}@example.com`, emailVerified: true })
})

afterEach(() => {
	jwksDown = false
	vi.useRealTimers()
})

afterAll(async () => {
	if (clientIds.length) await db.delete(oauthClient).where(inArray(oauthClient.clientId, clientIds))
	await db.delete(userTable).where(eq(userTable.id, userId))
})

/** An app of its own, connected with these scopes: its consent row and its grant. */
async function connectApp(scopes: string[]) {
	const clientId = `test-client-${randomUUID()}`
	clientIds.push(clientId)
	await db.insert(oauthClient).values({
		id: newId(),
		clientId,
		name: "Test client",
		redirectUris: ["http://127.0.0.1/callback"],
	})
	const consentId = newId()
	await db.insert(oauthConsent).values({ id: consentId, clientId, userId, scopes })
	const generation = newId()
	await db.insert(oauthGrants).values({ userId, clientId, generation })
	return { clientId, consentId, generation }
}

/** An access token signed with our real key, shaped like the ones the OAuth provider issues. */
async function accessToken(claims: Record<string, unknown>) {
	const { token } = await auth.api.signJWT({
		body: {
			payload: { sub: userId, iss: `${env.APP_URL}/api/auth`, aud: API_RESOURCE, ...claims },
		},
	})
	return token
}

const encode = (part: object) => Buffer.from(JSON.stringify(part)).toString("base64url")

const request = (token?: string) =>
	new Request("http://localhost:5180/api/v1/me", {
		headers: token ? { authorization: `Bearer ${token}` } : {},
	})

describe("authenticateApiRequest", () => {
	it("challenges requests without a bearer token", async () => {
		await expect(authenticateApiRequest(request())).rejects.toMatchObject({
			status: 401,
			headers: { "WWW-Authenticate": 'Bearer realm="klipstack"' },
		})
	})

	it("refuses tokens naming unknown keys without fetching the key set", async () => {
		const forged = `${encode({ alg: "EdDSA", kid: `unknown-${randomUUID()}` })}.${encode({ sub: userId })}.c2ln`
		fetchSpy.mockClear()
		await expect(authenticateApiRequest(request(forged))).rejects.toMatchObject({
			status: 401,
			code: "unauthorized",
		})
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it("turns verification failures into 401, and anything else into an error of ours", async () => {
		const { clientId, generation } = await connectApp(["library:read"])
		const claims = { azp: clientId, scope: "library:read", klip_grant: generation }
		// The control: the same claims, signed and addressed correctly, are accepted.
		await expect(authenticateApiRequest(request(await accessToken(claims)))).resolves.toMatchObject(
			{ userId, clientId },
		)

		const refused = [
			await accessToken({ ...claims, exp: Math.floor(Date.now() / 1000) - 60 }),
			// A token for the MCP server is not one for the API.
			await accessToken({ ...claims, aud: MCP_RESOURCE }),
			await accessToken({ ...claims, iss: "https://elsewhere.example.com/api/auth" }),
		]
		// Our own signature over a payload of someone else's choosing.
		const [header, , signature] = (await accessToken(claims)).split(".")
		refused.push(`${header}.${encode({ ...claims, sub: "someone-else" })}.${signature}`)
		for (const token of refused)
			await expect(authenticateApiRequest(request(token))).rejects.toMatchObject({
				status: 401,
				code: "unauthorized",
				message: "Invalid or expired access token.",
			})

		// Past the verifier's cache of our key set (five minutes), it fetches the set again.
		vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 10 * 60 * 1000 })
		const token = await accessToken(claims)
		jwksDown = true
		const outage = await authenticateApiRequest(request(token)).catch((error: unknown) => error)
		expect(outage).toBeInstanceOf(Error)
		expect(outage).not.toBeInstanceOf(ApiError)
		expect((outage as Error).message).toBe("Jwks failed: Service Unavailable")
	})

	it("uses only the token's scopes the consent still holds", async () => {
		const { clientId, consentId, generation } = await connectApp([
			"openid",
			"library:read",
			"library:write",
		])
		const token = await accessToken({
			azp: clientId,
			scope: "openid library:read library:write",
			klip_grant: generation,
		})
		expect(await authenticateApiRequest(request(token))).toEqual({
			userId,
			access: "write",
			via: "oauth",
			clientId,
		})

		// A token granted read alone stays read, whatever the consent holds.
		const readToken = await accessToken({
			azp: clientId,
			scope: "openid library:read",
			klip_grant: generation,
		})
		expect(await authenticateApiRequest(request(readToken))).toMatchObject({ access: "read" })

		const consent = (scopes: string[]) =>
			db.update(oauthConsent).set({ scopes }).where(eq(oauthConsent.id, consentId))
		await consent(["openid", "library:read"])
		expect(await authenticateApiRequest(request(token))).toMatchObject({ access: "read" })

		await consent(["openid"])
		await expect(authenticateApiRequest(request(token))).rejects.toMatchObject({
			status: 403,
			code: "insufficient_scope",
		})

		await db.delete(oauthConsent).where(eq(oauthConsent.id, consentId))
		await expect(authenticateApiRequest(request(token))).rejects.toMatchObject({
			status: 401,
			message: "The user disconnected this app.",
		})
	})

	it("rejects a token from a revoked grant even after the client receives new consent", async () => {
		const { clientId, consentId, generation } = await connectApp(["library:read"])
		// `client_id` alone, without `azp`, names the app too.
		const old = await accessToken({
			client_id: clientId,
			scope: "library:read",
			klip_grant: generation,
		})
		await expect(authenticateApiRequest(request(old))).resolves.toMatchObject({ userId, clientId })

		// Disconnecting deletes the consent, and with it the grant (migration 0014). Connecting
		// again makes a new grant reference and a new consent.
		await db.delete(oauthConsent).where(eq(oauthConsent.id, consentId))
		expect(await db.select().from(oauthGrants).where(eq(oauthGrants.clientId, clientId))).toEqual(
			[],
		)
		const renewed = newId()
		await db.insert(oauthGrants).values({ userId, clientId, generation: renewed })
		await db
			.insert(oauthConsent)
			.values({ id: newId(), clientId, userId, scopes: ["library:read"] })

		await expect(authenticateApiRequest(request(old))).rejects.toMatchObject({
			status: 401,
			message: "The user disconnected this app.",
		})
		const unbound = await accessToken({ client_id: clientId, scope: "library:read" })
		await expect(authenticateApiRequest(request(unbound))).rejects.toMatchObject({ status: 401 })
		const fresh = await accessToken({
			client_id: clientId,
			scope: "library:read",
			klip_grant: renewed,
		})
		await expect(authenticateApiRequest(request(fresh))).resolves.toMatchObject({
			userId,
			clientId,
		})
	})

	it("refuses a token for an account whose email is not verified", async () => {
		const { clientId, generation } = await connectApp(["library:read"])
		const token = await accessToken({
			azp: clientId,
			scope: "library:read",
			klip_grant: generation,
		})
		await expect(authenticateApiRequest(request(token))).resolves.toMatchObject({ userId })

		const unverified = `${userId}-unverified`
		await db.insert(userTable).values({
			id: unverified,
			name: "Unverified",
			email: `${unverified}@example.com`,
			emailVerified: false,
		})
		try {
			await db
				.insert(oauthConsent)
				.values({ id: newId(), clientId, userId: unverified, scopes: ["library:read"] })
			await db.insert(oauthGrants).values({ userId: unverified, clientId, generation })
			const theirs = await accessToken({
				sub: unverified,
				azp: clientId,
				scope: "library:read",
				klip_grant: generation,
			})
			await expect(authenticateApiRequest(request(theirs))).rejects.toMatchObject({
				status: 401,
				message: "The user disconnected this app.",
			})
		} finally {
			await db.delete(userTable).where(eq(userTable.id, unverified))
		}
	})

	it("refuses an address before any lookup once too many of its tokens were refused", async () => {
		// An address of its own, signed as the server signs it: the other tests share "unknown".
		const address = `198.51.100.${Date.now() % 250}`
		const signature = createHmac("sha256", env.BETTER_AUTH_SECRET).update(address).digest("hex")
		const from = (token: string) =>
			new Request("http://localhost:5180/api/v1/me", {
				headers: {
					authorization: `Bearer ${token}`,
					"x-klipstack-client-ip": address,
					"x-klipstack-client-signature": signature,
				},
			})
		const { clientId, generation } = await connectApp(["library:read"])
		const good = await accessToken({ azp: clientId, scope: "library:read", klip_grant: generation })
		// Accepted tokens never count, however many.
		for (let i = 0; i < BAD_BEARER_LIMIT.limit + 10; i++)
			await expect(authenticateApiRequest(from(good))).resolves.toMatchObject({ userId })

		const unknownKey = `${encode({ alg: "EdDSA", kid: `unknown-${randomUUID()}` })}.e30.c2ln`
		for (let i = 0; i < BAD_BEARER_LIMIT.limit; i++)
			await expect(authenticateApiRequest(from(unknownKey))).rejects.toMatchObject({
				status: 401,
			})
		// Even the good token is refused now: the address is turned away before it is looked at.
		await expect(authenticateApiRequest(from(good))).rejects.toMatchObject({
			status: 429,
			code: "rate_limited",
		})
		// Another address still gets its answer.
		await expect(authenticateApiRequest(request(good))).resolves.toMatchObject({ userId })
	})
})
