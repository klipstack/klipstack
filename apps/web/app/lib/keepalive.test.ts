import { describe, expect, it } from "vitest"
import { fitsKeepalive } from "./keepalive"

describe("fitsKeepalive", () => {
	it("counts bytes, not characters", () => {
		expect(fitsKeepalive("a".repeat(59_999))).toBe(true)
		expect(fitsKeepalive("a".repeat(60_000))).toBe(false)
		// 25,000 characters of three bytes each: 75,000 bytes.
		expect(fitsKeepalive("漢".repeat(25_000))).toBe(false)
		expect(fitsKeepalive("漢".repeat(19_999))).toBe(true)
	})
})
