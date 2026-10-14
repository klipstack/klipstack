import { describe, expect, it } from "vitest"
import { withDictated } from "./dictated-note"

describe("withDictated", () => {
	it("writes what is heard into an empty note", () => {
		expect(withDictated("", " Tides follow the moon. ", 100)).toBe("Tides follow the moon.")
	})

	it("puts it on a line of its own after what was written, without blank lines", () => {
		expect(withDictated("First thought.\n\n", "Second one", 100)).toBe("First thought.\nSecond one")
	})

	it("leaves the note as it was until something is heard", () => {
		expect(withDictated("Written.  ", "  ", 100)).toBe("Written.  ")
	})

	it("never goes past the note's limit", () => {
		expect(withDictated("abc", "defgh", 6)).toBe("abc\nde")
	})
})
