import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

/**
 * Under an https APP_URL, as on klipstack.com, better-auth names the session cookie
 * `__Secure-klip.session_token`. The other tests run with the local http APP_URL, whose cookie has
 * no prefix: this one holds the check to production's name.
 */

let crossSiteAllowed: typeof import("./origin.server").crossSiteAllowed

beforeAll(async () => {
	vi.stubEnv("APP_URL", "https://klip.example.com")
	vi.resetModules()
	;({ crossSiteAllowed } = await import("./origin.server"))
})
afterAll(() => {
	vi.unstubAllEnvs()
	vi.resetModules()
})

const post = (headers: Record<string, string>) =>
	new Request("https://klip.example.com/prefs", { method: "POST", headers, body: "x=1" })

describe("cross-site writes under https", () => {
	it("count production's session cookie", async () => {
		const cookie = "theme=dark; __Secure-klip.session_token=abc.def"
		expect(await crossSiteAllowed(post({ cookie, origin: "https://other.example.com" }))).toBe(
			false,
		)
		expect(await crossSiteAllowed(post({ cookie }))).toBe(false)
		expect(await crossSiteAllowed(post({ cookie, origin: "https://klip.example.com" }))).toBe(true)
	})
})
