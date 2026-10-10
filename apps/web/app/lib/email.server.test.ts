import { errorLabel } from "@klipstack/log"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EmailError, renderEmail, sendEmail } from "./email.server"

const email = {
	to: "someone@example.com",
	subject: "Sign in",
	html: "",
	text: "https://x.test/link",
}

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

describe("sendEmail without Resend", () => {
	it("prints the email in development", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {})
		await sendEmail(email)
		expect(spy.mock.calls.flat().join("")).toContain("https://x.test/link")
	})

	it("refuses in production with a code, printing nothing", async () => {
		vi.stubEnv("NODE_ENV", "production")
		const spy = vi.spyOn(console, "log").mockImplementation(() => {})
		const error = await sendEmail(email).catch((e: unknown) => e)
		expect(error).toBeInstanceOf(EmailError)
		expect(errorLabel(error)).toBe("EmailError code=EMAIL_NOT_CONFIGURED")
		expect(spy).not.toHaveBeenCalled()
	})
})

describe("sendEmail with Resend", () => {
	afterEach(() => {
		vi.doUnmock("./env.server")
		vi.doUnmock("resend")
		vi.resetModules()
	})

	it("names a failed delivery by Resend's code", async () => {
		vi.resetModules()
		vi.doMock("./env.server", () => ({
			env: { RESEND_API_KEY: "re_test", EMAIL_FROM: "Klipstack <mail@x.test>" },
		}))
		vi.doMock("resend", () => ({
			Resend: class {
				emails = {
					send: async () => ({
						data: null,
						error: {
							name: "rate_limit_exceeded",
							message: "Too many emails to someone@example.com",
							statusCode: 429,
						},
					}),
				}
			},
		}))
		const mocked = await import("./email.server")
		const error = await mocked.sendEmail(email).catch((e: unknown) => e)
		expect(error).toBeInstanceOf(mocked.EmailError)
		expect(errorLabel(error)).toBe(
			"EmailError code=EMAIL_SEND_FAILED cause=ResendError cause.code=rate_limit_exceeded",
		)
	})
})

describe("renderEmail", () => {
	it("heads the email with the app icon and the name as text", () => {
		const { html } = renderEmail({ heading: "Sign in", body: "Hi", cta: { label: "Go", url: "x" } })
		expect(html).toMatch(/<img src="https?:\/\/[^"]+\/icons\/icon-email\.png\?v=2"[^>]* alt=""/)
		expect(html).toContain(">Klipstack</span>")
		expect(html).toContain("background:#243f6c")
	})
})
