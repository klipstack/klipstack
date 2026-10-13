import { describe, expect, it } from "vitest"
import { growingFit, postItChars, tiltDegrees, tiltFor } from "./post-it"

describe("postItChars", () => {
	it("makes a short note a small square, and a long one a balanced rectangle, within bounds", () => {
		expect(postItChars("")).toBe(14)
		expect(postItChars("Yes")).toBe(14)
		// √(4 × 400) = 40: wider than the shortest, not yet the widest.
		expect(postItChars("a".repeat(400))).toBe(40)
		expect(postItChars("a".repeat(5000))).toBe(52)
	})

	it("reads a link as its title, and a line break as a line of its own", () => {
		const link = "[A title](/read/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b)"
		expect(postItChars(`${"a".repeat(100)} ${link}`)).toBe(
			postItChars(`${"a".repeat(100)} A title`),
		)
		expect(postItChars("a\nb\nc\nd\ne\nf\ng\nh\ni")).toBeGreaterThan(postItChars("abcdefghi"))
	})
})

describe("tiltDegrees", () => {
	it("leans neighbors apart, comes round again, and leans compact notes barely", () => {
		expect(Math.sign(tiltDegrees(0))).not.toBe(Math.sign(tiltDegrees(1)))
		expect(tiltDegrees(4)).toBe(tiltDegrees(0))
		expect(tiltDegrees(-1)).toBe(tiltDegrees(3))
		for (const n of [0, 1, 2, 3]) expect(Math.abs(tiltDegrees(n, "compact"))).toBeLessThan(1)
	})

	it("leans a note by its id the same way every time", () => {
		expect(tiltFor("0190a1b2")).toBe(tiltFor("0190a1b2"))
		expect(new Set(["a", "b", "c", "d"].map((id) => tiltDegrees(tiltFor(id)))).size).toBe(4)
	})
})

describe("growingFit", () => {
	it("grows with the text and never shrinks under the caret", () => {
		expect(growingFit("Short", "Shorter")).toBe("Shorter")
		expect(growingFit("A longer note", "A lo")).toBe("A longer note")
	})
})
