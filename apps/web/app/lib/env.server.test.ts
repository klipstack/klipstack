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
