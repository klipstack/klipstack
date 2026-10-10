import { afterEach, describe, expect, it, vi } from "vitest"
import { securityMiddleware } from "../../security-middleware.js"

function run() {
	const headers: Record<string, string> = {}
	const req = { ip: "203.0.113.7", headers: {} as Record<string, string>, socket: {} }
	const res = { setHeader: (name: string, value: string) => (headers[name] = value) }
	securityMiddleware(req as never, res as never, () => {})
	return headers
}

describe("securityMiddleware", () => {
	afterEach(() => vi.unstubAllEnvs())

	it("tells browsers to use HTTPS only in production", () => {
		vi.stubEnv("NODE_ENV", "production")
		expect(run()["Strict-Transport-Security"]).toBe("max-age=31536000")
		vi.stubEnv("NODE_ENV", "development")
		expect(run()["Strict-Transport-Security"]).toBeUndefined()
	})
})
