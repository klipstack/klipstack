import { describe, expect, it } from "vitest"
import { stepTextSize, textScale } from "./reader-type"

describe("reader type", () => {
	it("stays at either end of the sizes, and ignores a system scale that is not a number", () => {
		expect(stepTextSize("small", -1)).toBe("small")
		expect(stepTextSize("largest", 1)).toBe("largest")
		expect(textScale("default", Number.NaN)).toBe(1)
	})
})
