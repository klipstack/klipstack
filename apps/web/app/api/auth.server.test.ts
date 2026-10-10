import { createHmac } from "node:crypto"
import { APIError } from "better-auth/api"
import { beforeEach, describe, expect, it, vi } from "vitest"

const verify = vi.fn()
const consented = vi.fn()
const knownKey = vi.fn()
const grant = vi.fn()
vi.mock("~/lib/credential-policy.server", () => ({
	validGrant: (...args: unknown[]) => grant(...args),
}))

vi.mock("better-auth/oauth2", async (original) => ({
	...(await original<typeof import("better-auth/oauth2")>()),
	verifyAccessTokenRequest: (...args: unknown[]) => verify(...args),
}))
vi.mock("~/lib/auth.server", () => ({ API_RESOURCE: "http://localhost:5180/api" }))
vi.mock("~/lib/signing-keys.server", () => ({
	namesKnownSigningKey: (token: string) => knownKey(token),
}))
vi.mock("~/services/oauth-apps.server", async (original) => ({
	...(await original<typeof import("~/services/oauth-apps.server")>()),
	consentedScopes: (...args: unknown[]) => consented(...args),
}))

const { authenticateApiRequest } = await import("./auth.server")
const { env } = await import("~/lib/env.server")
const { BAD_BEARER_LIMIT } = await import("~/lib/rate-limit.server")

const request = (token?: string) =>
	new Request("http://localhost:5180/api/v1/me", {
		headers: token ? { authorization: `Bearer ${token}` } : {},
	})

beforeEach(() => {
	verify.mockReset()
	consented.mockReset()
	knownKey.mockReset().mockResolvedValue(true)
	grant.mockReset().mockResolvedValue(true)
})

describe("authenticateApiRequest", () => {
	it("challenges requests without a bearer token", async () => {
		await expect(authenticateApiRequest(request())).rejects.toMatchObject({
			status: 401,
			headers: { "WWW-Authenticate": 'Bearer realm="klipstack"' },
		})
	})

	it("refuses tokens naming unknown keys without verifying them", async () => {
		knownKey.mockResolvedValue(false)
		await expect(authenticateApiRequest(request("a.b.c"))).rejects.toMatchObject({ status: 401 })
		expect(verify).not.toHaveBeenCalled()
	})

	it("turns verification failures into 401, and anything else into an error of ours", async () => {
		verify.mockRejectedValueOnce(new APIError("UNAUTHORIZED", { message: "token expired" }))
		await expect(authenticateApiRequest(request("a.b.c"))).rejects.toMatchObject({
			status: 401,
			code: "unauthorized",
		})
		const outage = new Error("Jwks failed: Service Unavailable")
		verify.mockRejectedValueOnce(outage)
		await expect(authenticateApiRequest(request("a.b.c"))).rejects.toBe(outage)
	})

	it("uses only the token's scopes the consent still holds", async () => {
		verify.mockResolvedValue({
			sub: "user-1",
			azp: "klipstack-cli",
			scope: "openid library:read library:write",
		})
		consented.mockResolvedValue(["openid", "library:read", "library:write"])
		expect(await authenticateApiRequest(request("a.b.c"))).toEqual({
			userId: "user-1",
			access: "write",
			via: "oauth",
			clientId: "klipstack-cli",
		})
		expect(consented).toHaveBeenCalledWith("user-1", "klipstack-cli")

		consented.mockResolvedValue(["openid", "library:read"])
		expect(await authenticateApiRequest(request("a.b.c"))).toMatchObject({ access: "read" })

		consented.mockResolvedValue(["openid"])
		await expect(authenticateApiRequest(request("a.b.c"))).rejects.toMatchObject({
			status: 403,
			code: "insufficient_scope",
		})

		consented.mockResolvedValue(null)
		await expect(authenticateApiRequest(request("a.b.c"))).rejects.toMatchObject({
			status: 401,
			message: "The user disconnected this app.",
		})
	})
	it("rejects a token from a revoked grant even after the client receives new consent", async () => {
		verify.mockResolvedValue({
			sub: "user-1",
			client_id: "client",
			scope: "library:read",
			klip_grant: "old",
		})
		consented.mockResolvedValue(["library:read"])
		grant.mockResolvedValue(false)
		await expect(authenticateApiRequest(request("a.b.c"))).rejects.toMatchObject({ status: 401 })
		expect(grant).toHaveBeenCalledWith("user-1", "client", "old")
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
		// Accepted tokens never count, however many.
		verify.mockResolvedValue({ sub: "user-1", azp: "cli", scope: "library:read" })
		consented.mockResolvedValue(["library:read"])
		for (let i = 0; i < BAD_BEARER_LIMIT.limit + 10; i++)
			await expect(authenticateApiRequest(from("a.b.c"))).resolves.toMatchObject({
				userId: "user-1",
			})

		knownKey.mockResolvedValue(false)
		for (let i = 0; i < BAD_BEARER_LIMIT.limit; i++)
			await expect(authenticateApiRequest(from("x.y.z"))).rejects.toMatchObject({ status: 401 })
		knownKey.mockClear()
		await expect(authenticateApiRequest(from("x.y.z"))).rejects.toMatchObject({
			status: 429,
			code: "rate_limited",
		})
		expect(knownKey).not.toHaveBeenCalled()
		// Another address still gets its answer.
		await expect(authenticateApiRequest(request("x.y.z"))).rejects.toMatchObject({ status: 401 })
	})
})
