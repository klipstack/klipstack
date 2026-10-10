import { describe, expect, it } from "vitest"
import { poolMax } from "./env"

describe("poolMax", () => {
	it("defaults to 10 and reads a whole number", () => {
		expect(poolMax({})).toBe(10)
		expect(poolMax({ PG_POOL_MAX: "" })).toBe(10)
		expect(poolMax({ PG_POOL_MAX: "25" })).toBe(25)
	})
	it("refuses anything else", () => {
		for (const value of ["0", "-1", "2.5", "many", "1e3x"])
			expect(() => poolMax({ PG_POOL_MAX: value })).toThrow("PG_POOL_MAX")
	})
})
