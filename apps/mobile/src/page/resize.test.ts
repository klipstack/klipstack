import { QUOTE_MAX } from "@klipstack/api-contract/names"
import { describe, expect, it } from "vitest"
import { moveEnd, wordEdges } from "./resize"

const TEXT = "Alpha beta, gamma delta."
//            0     6     12    18
const edges = wordEdges(TEXT)
const draft = { start: 6, end: 17 } // "beta, gamma"

describe("moveEnd", () => {
	it("snaps each end to the nearest word edge", () => {
		expect(moveEnd(edges, draft, "end", 21)).toEqual({ start: 6, end: 23 })
		expect(moveEnd(edges, draft, "end", 9)).toEqual({ start: 6, end: 10 })
		expect(moveEnd(edges, draft, "start", 2)).toEqual({ start: 0, end: 17 })
		expect(moveEnd(edges, draft, "start", 14)).toEqual({ start: 12, end: 17 })
	})

	it("keeps a word, and returns the same draft when nothing moves", () => {
		expect(moveEnd(edges, draft, "start", 30)).toEqual({ start: 12, end: 17 })
		expect(moveEnd(edges, draft, "end", 0)).toEqual({ start: 6, end: 10 })
		expect(moveEnd(edges, draft, "end", 16)).toBe(draft)
	})

	it("stays within the longest quote", () => {
		const long = `${"word ".repeat(QUOTE_MAX)}end`
		const moved = moveEnd(wordEdges(long), { start: 0, end: 4 }, "end", long.length)
		expect(moved.end).toBeLessThanOrEqual(QUOTE_MAX)
		expect(moved.end).toBeGreaterThan(QUOTE_MAX - 6)
	})
})
