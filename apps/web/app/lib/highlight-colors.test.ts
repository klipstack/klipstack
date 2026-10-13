import { describe, expect, it } from "vitest"
import { highlightColor, highlightColorName } from "./highlight-colors"

describe("highlightColorName", () => {
	it("names each stored color", () => {
		expect([0, 1, 2, 3, 4].map(highlightColorName)).toEqual([
			"yellow",
			"green",
			"blue",
			"pink",
			"orange",
		])
	})

	it("falls back to yellow for a missing or unknown color", () => {
		expect(highlightColorName(undefined)).toBe("yellow")
		expect(highlightColorName(null)).toBe("yellow")
		expect(highlightColorName(9)).toBe("yellow")
		expect(highlightColorName(-1)).toBe("yellow")
	})
})

it("highlightColor sets the attribute app.css colors by", () => {
	expect(highlightColor(2)).toEqual({ "data-hl": "blue" })
})
