import { describe, expect, it } from "vitest"
import { rateLimit } from "./rate-limit.server"

describe("rateLimit", () => {
	it("counts hits in the window, and gives one back on refund", () => {
		const key = `test-${Date.now()}-${Math.random()}`
		const first = rateLimit(key, 2, 60_000)
		const second = rateLimit(key, 2, 60_000)
		expect(first.ok && second.ok).toBe(true)
		expect(rateLimit(key, 2, 60_000)).toMatchObject({ ok: false, retryAfterSeconds: 60 })
		if (!second.ok) throw new Error("expected ok")
		second.refund()
		second.refund() // once only
		const third = rateLimit(key, 2, 60_000)
		expect(third.ok).toBe(true)
		expect(rateLimit(key, 2, 60_000).ok).toBe(false)
	})
})
