import { generateKeyPairSync } from "node:crypto"
import { MOBILE_REDIRECT_URI } from "@klipstack/api-contract/auth"
import { pool } from "@klipstack/db"
import { afterAll, describe, expect, it } from "vitest"

// Every provider configured. No request reaches them: starting a sign-in only builds the address.
process.env.GOOGLE_CLIENT_ID = "test-client"
process.env.GOOGLE_CLIENT_SECRET = "test-secret"
process.env.GITHUB_CLIENT_ID = "test-client"
process.env.GITHUB_CLIENT_SECRET = "test-secret"
process.env.APPLE_TEAM_ID = "TEAM123456"
process.env.APPLE_SERVICES_ID = "com.example.reader.web"
process.env.APPLE_KEY_ID = "KEY1234567"
process.env.APPLE_PRIVATE_KEY = generateKeyPairSync("ec", { namedCurve: "P-256" })
	.privateKey.export({ type: "pkcs8", format: "pem" })
	.toString()

const { env } = await import("./env.server")
const { appRedirectIn, enabledProviders, PROVIDER_ORIGINS, PROVIDERS, startProviderSignIn } =
	await import("./provider-sign-in.server")

afterAll(() => pool.end())

describe("PROVIDER_ORIGINS", () => {
	it("is where each provider's sign-in starts", async () => {
		expect(enabledProviders).toEqual([...PROVIDERS])
		for (const provider of PROVIDERS) {
			const start = await startProviderSignIn(new Request(new URL("/login", env.APP_URL)), {
				provider,
				signup: false,
			})
			const location = new URL(start.headers.get("location") ?? "")
			expect(location.origin, provider).toBe(PROVIDER_ORIGINS[provider])
		}
	})
})

describe("appRedirectIn", () => {
	const authorize = (redirectUri: string) =>
		`/api/auth/oauth2/authorize?${new URLSearchParams({ client_id: "x", redirect_uri: redirectUri })}`

	it("is the iPhone app's redirect URI in the request a provider's sheet goes on to", () => {
		expect(appRedirectIn(authorize(MOBILE_REDIRECT_URI))).toBe(MOBILE_REDIRECT_URI)
	})

	it("is nothing for another address, or another app's redirect URI", () => {
		expect(appRedirectIn(null)).toBeNull()
		expect(appRedirectIn("/home")).toBeNull()
		expect(appRedirectIn(authorize("https://evil.example/callback"))).toBeNull()
		expect(appRedirectIn(`/settings?redirect_uri=${MOBILE_REDIRECT_URI}`)).toBeNull()
	})
})
