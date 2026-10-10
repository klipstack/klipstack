import { describe, expect, it } from "vitest"
import { LINE, lineAt, mapLine } from "./scroll-sync"

describe("mapLine", () => {
	// The editor: a top of 400, then cards of 300 and 500. The preview: 200, then 600 and 100.
	const editor = [0, 400, 700, 1200]
	const preview = [100, 300, 900, 1000]

	it("goes to the same part, as far through it", () => {
		expect(mapLine(editor, 200, preview)).toBe(200)
		expect(mapLine(editor, 400, preview)).toBe(300)
		expect(mapLine(editor, 550, preview)).toBe(600)
		expect(mapLine(editor, 950, preview)).toBe(950)
		expect(mapLine(preview, 600, editor)).toBe(550)
	})

	it("stays at the ends outside them", () => {
		expect(mapLine(editor, -50, preview)).toBe(100)
		expect(mapLine(editor, 5000, preview)).toBe(1000)
	})

	it("puts the parts one side lacks in the other's last", () => {
		// Halfway through the third part: halfway through the last one there is.
		expect(mapLine(editor, 950, [0, 100, 300])).toBe(200)
		expect(mapLine([0, 100], 50, preview)).toBe(200)
	})
})

describe("lineAt", () => {
	// A view of 900 over 3000 of content: it scrolls up to 2100.
	it("is a third of the way down, away from the ends", () => {
		expect(lineAt(1000, 900, 2100)).toBe(LINE)
	})

	it("rises to the top edge at the start, and sinks to the bottom one at the end", () => {
		expect(lineAt(0, 900, 2100)).toBe(0)
		expect(lineAt(150, 900, 2100)).toBeCloseTo(1 / 6)
		expect(lineAt(2100, 900, 2100)).toBe(1)
		expect(lineAt(1800, 900, 2100)).toBeCloseTo(2 / 3)
	})

	it("moves without jumps into and out of either end", () => {
		expect(lineAt(300, 900, 2100)).toBeCloseTo(LINE)
		expect(lineAt(1500, 900, 2100)).toBeCloseTo(LINE)
	})
})
