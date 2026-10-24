import { describe, expect, it } from "vitest"
import { accessToken, authorizeUrl, callbackOf, exchangeCode, type Tokens } from "./connect"

const APP = "https://klipstack.com"

function memoryStore(tokens: Tokens | null) {
	const store = {
		tokens,
		get: async () => store.tokens,
		set: async (next: Tokens | null) => {
			store.tokens = next
		},
	}
	return store
}

/** A token endpoint that answers `status` with `body`, and keeps what it was sent. */
function tokenEndpoint(status: number, body: object = {}) {
	const sent: URLSearchParams[] = []
	const fetchImpl = (async (url: unknown, init?: RequestInit) => {
		expect(String(url)).toBe(`${APP}/api/auth/oauth2/token`)
		sent.push(new URLSearchParams(String(init?.body)))
		return new Response(JSON.stringify(body), { status })
	}) as unknown as typeof fetch
	return { fetchImpl, sent }
}

describe("the extension's sign-in", () => {
	it("asks for the API, with PKCE, back to the server's own page", () => {
		const url = new URL(authorizeUrl(APP, { challenge: "c", state: "s" }))
		expect(url.origin + url.pathname).toBe(`${APP}/api/auth/oauth2/authorize`)
		expect(Object.fromEntries(url.searchParams)).toMatchObject({
			client_id: "klipstack-extension",
			redirect_uri: `${APP}/extension/connected`,
			resource: `${APP}/api`,
			code_challenge: "c",
			code_challenge_method: "S256",
			state: "s",
			// The consent page is what asks an old sign-in to sign in again.
			prompt: "consent",
		})
		expect(url.searchParams.get("scope")?.split(" ")).toEqual(
			expect.arrayContaining(["offline_access", "library:read", "library:write"]),
		)
	})

	it("reads only its own callback, on the server, from a tab's address", () => {
		expect(callbackOf(APP, `${APP}/extension/connected?code=abc&state=s`)).toEqual({
			state: "s",
			code: "abc",
			error: null,
		})
		expect(callbackOf(APP, `${APP}/extension/connected?error=access_denied&state=s`)).toMatchObject(
			{
				code: null,
				error: "access_denied",
			},
		)
		for (const url of [
			"https://evil.example/extension/connected?code=abc&state=s",
			"https://klipstack.com.evil.example/extension/connected?code=abc&state=s",
			`${APP}/extension?code=abc&state=s`,
			`${APP}/extension/connected?code=abc`,
			"not a url",
		])
			expect(callbackOf(APP, url), url).toBeNull()
	})

	it("exchanges the code with the verifier and the same redirect", async () => {
		const { fetchImpl, sent } = tokenEndpoint(200, {
			access_token: "a1",
			refresh_token: "r1",
			expires_in: 3600,
		})
		const tokens = await exchangeCode(APP, { code: "abc", verifier: "v" }, fetchImpl, 1_000)
		expect(tokens).toEqual({ accessToken: "a1", refreshToken: "r1", expiresAt: 3_601_000 })
		expect(Object.fromEntries(sent[0]!)).toMatchObject({
			grant_type: "authorization_code",
			code: "abc",
			code_verifier: "v",
			redirect_uri: `${APP}/extension/connected`,
			client_id: "klipstack-extension",
		})
	})
})

describe("accessToken", () => {
	const kept = { accessToken: "a1", refreshToken: "r1", expiresAt: 100_000 }

	it("uses the kept token while it is good, without asking the server", async () => {
		const { fetchImpl, sent } = tokenEndpoint(500)
		const store = memoryStore(kept)
		expect(await accessToken(APP, store, { fetchImpl, now: 10_000 })).toBe("a1")
		expect(sent).toHaveLength(0)
	})

	it("refreshes a token about to expire, and keeps the rotated refresh token", async () => {
		const { fetchImpl, sent } = tokenEndpoint(200, {
			access_token: "a2",
			refresh_token: "r2",
			expires_in: 60,
		})
		const store = memoryStore(kept)
		// 30 seconds before it expires: within the margin.
		expect(await accessToken(APP, store, { fetchImpl, now: 70_000 })).toBe("a2")
		expect(sent[0]?.get("refresh_token")).toBe("r1")
		expect(store.tokens).toEqual({ accessToken: "a2", refreshToken: "r2", expiresAt: 130_000 })
	})

	it("refreshes when the API refused the kept token, however fresh", async () => {
		const { fetchImpl } = tokenEndpoint(200, { access_token: "a2", expires_in: 3600 })
		const store = memoryStore(kept)
		expect(await accessToken(APP, store, { fetchImpl, now: 0, force: true })).toBe("a2")
		// No new refresh token in the answer: the old one still works.
		expect(store.tokens?.refreshToken).toBe("r1")
	})

	it("forgets a sign-in whose refresh token the server refuses (the reader disconnected it)", async () => {
		const { fetchImpl } = tokenEndpoint(400, { error: "invalid_grant" })
		const store = memoryStore(kept)
		expect(await accessToken(APP, store, { fetchImpl, now: 0, force: true })).toBeNull()
		expect(store.tokens).toBeNull()
	})

	it("keeps the sign-in when the server can't answer, and says so", async () => {
		const { fetchImpl } = tokenEndpoint(503)
		const store = memoryStore(kept)
		await expect(accessToken(APP, store, { fetchImpl, now: 0, force: true })).rejects.toThrow()
		expect(store.tokens).toEqual(kept)
	})

	it("has none before the first sign-in", async () => {
		const { fetchImpl } = tokenEndpoint(500)
		expect(await accessToken(APP, memoryStore(null), { fetchImpl })).toBeNull()
	})
})
