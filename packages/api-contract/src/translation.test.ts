import { describe, expect, it } from "vitest"
import { translationCredits, translationWords } from "./translation"

describe("translation credits", () => {
	it("cost one per started thousand words, and one at least", () => {
		expect([0, 1, 1000, 1001, 20_000].map(translationCredits)).toEqual([1, 1, 1, 2, 20])
	})

	it("count Chinese by its words, not by its runs between punctuation", () => {
		// Two runs of characters, about a dozen words.
		expect(translationWords("泡沫可以破裂，但真实的需求不会因为泡沫破裂而消失。")).toBeGreaterThan(
			8,
		)
		expect(translationWords("A bubble can burst, but real demand won't vanish.")).toBe(9)
	})
})
