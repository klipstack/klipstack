import { describe, expect, it, vi } from "vitest"
import { inTime } from "./in-time"

describe("inTime", () => {
	it("gives the answer in time, and null for a late or failed one", async () => {
		vi.useFakeTimers()
		try {
			const quick = inTime(Promise.resolve("topics"), 1500)
			expect(await quick).toBe("topics")

			const slow = inTime(new Promise((resolve) => setTimeout(() => resolve("late"), 5000)), 1500)
			await vi.advanceTimersByTimeAsync(1500)
			expect(await slow).toBeNull()

			expect(await inTime(Promise.reject(new Error("404")), 1500)).toBeNull()
		} finally {
			vi.useRealTimers()
		}
	})
})
