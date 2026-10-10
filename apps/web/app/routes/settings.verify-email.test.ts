import { APIError } from "better-auth/api"
import { beforeEach, expect, it, vi } from "vitest"
import { action } from "./settings.verify-email"

const fixture = vi.hoisted(() => ({
	user: { email: "owner@example.com", emailVerified: false },
	emailEnabled: true,
	send: vi.fn(),
}))
vi.mock("~/lib/session.server", () => ({ requireUser: () => fixture.user }))
vi.mock("~/lib/email.server", () => ({
	get emailEnabled() {
		return fixture.emailEnabled
	},
}))
vi.mock("~/lib/email-verification.server", () => ({ requestEmailVerification: fixture.send }))

const request = () =>
	new Request("http://localhost/settings/verify-email", {
		method: "POST",
		body: new URLSearchParams({
			email: "someone-else@example.com",
			callbackURL: "https://evil.example",
		}),
	})

beforeEach(() => {
	fixture.user.emailVerified = false
	fixture.emailEnabled = true
	fixture.send.mockReset().mockResolvedValue(undefined)
})

it("uses the signed-in email, ignoring client-supplied values", async () => {
	expect(await action({ request: request() } as never)).toEqual({ result: "sent" })
	expect(fixture.send).toHaveBeenCalledWith("owner@example.com", expect.any(Headers))
})

it("does not send for already verified accounts or when delivery is unavailable", async () => {
	fixture.user.emailVerified = true
	expect(await action({ request: request() } as never)).toEqual({ result: "verified" })
	fixture.user.emailVerified = false
	fixture.emailEnabled = false
	expect(await action({ request: request() } as never)).toMatchObject({
		data: { result: "unavailable" },
		init: { status: 503 },
	})
	expect(fixture.send).not.toHaveBeenCalled()
})

it("keeps rate-limit errors in the form and preserves Retry-After", async () => {
	fixture.send.mockRejectedValue(
		new APIError("TOO_MANY_REQUESTS", { message: "limited" }, { "Retry-After": "61" }),
	)
	expect(await action({ request: request() } as never)).toMatchObject({
		data: { result: "limited", minutes: 2 },
		init: { status: 429, headers: { "Retry-After": "61" } },
	})
})

it("reports delivery failures without exposing provider errors", async () => {
	fixture.send.mockRejectedValue(new Error("secret provider details"))
	expect(await action({ request: request() } as never)).toMatchObject({
		data: { result: "failed" },
		init: { status: 503 },
	})
})
