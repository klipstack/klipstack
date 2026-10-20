import { afterEach, expect, it, vi } from "vitest"

afterEach(() => {
	vi.unstubAllEnvs()
	vi.resetModules()
})

it.each([
	["invite", true],
	// The wait list only adds a form to ask for an invite: sign-up still needs one.
	["waitlist", true],
	["open", false],
] as const)("SIGNUP_MODE=%s requires an invite: %s", async (mode, required) => {
	vi.stubEnv("SIGNUP_MODE", mode)
	vi.resetModules()
	const { invitesRequired } = await import("./env.server")
	expect(invitesRequired).toBe(required)
})

it.each(["https://example.com/", "https://example.com//", "https://example.com"])(
	"APP_URL=%s is read without a trailing slash",
	async (url) => {
		vi.stubEnv("APP_URL", url)
		vi.resetModules()
		const { env } = await import("./env.server")
		expect(env.APP_URL).toBe("https://example.com")
	},
)

it("reads empty Apple app values as unset", async () => {
	vi.stubEnv("APPLE_TEAM_ID", "")
	vi.stubEnv("APPLE_BUNDLE_ID", "")
	vi.resetModules()
	const { env } = await import("./env.server")
	expect([env.APPLE_TEAM_ID, env.APPLE_BUNDLE_ID]).toEqual([undefined, undefined])
})

it("reads a team ID and a bundle ID", async () => {
	vi.stubEnv("APPLE_TEAM_ID", "AB12CD34EF")
	vi.stubEnv("APPLE_BUNDLE_ID", "com.example.reader")
	vi.resetModules()
	const { env } = await import("./env.server")
	expect([env.APPLE_TEAM_ID, env.APPLE_BUNDLE_ID]).toEqual(["AB12CD34EF", "com.example.reader"])
})

it.each([
	["APPLE_TEAM_ID", "ab12cd34ef"],
	["APPLE_TEAM_ID", "AB12CD34E"],
	["APPLE_BUNDLE_ID", "comexample"],
	["APPLE_BUNDLE_ID", "com.example.reader/"],
	// Sign in with Apple needs the team, the Services ID and the key together.
	["APPLE_SERVICES_ID", "com.example.reader.web"],
	["APPLE_KEY_ID", "KEY1234567"],
])("refuses %s=%s", async (name, value) => {
	vi.stubEnv(name, value)
	vi.resetModules()
	vi.spyOn(console, "error").mockImplementation(() => {})
	await expect(import("./env.server")).rejects.toThrow("Invalid environment variables")
})

it("refuses Sign in with Apple without the team ID", async () => {
	vi.stubEnv("APPLE_TEAM_ID", "")
	vi.stubEnv("APPLE_SERVICES_ID", "com.example.reader.web")
	vi.stubEnv("APPLE_KEY_ID", "KEY1234567")
	vi.stubEnv("APPLE_PRIVATE_KEY", "-----BEGIN PRIVATE KEY-----\\n…\\n-----END PRIVATE KEY-----")
	vi.resetModules()
	vi.spyOn(console, "error").mockImplementation(() => {})
	await expect(import("./env.server")).rejects.toThrow("Invalid environment variables")
})
