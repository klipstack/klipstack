import { describe, expect, it } from "vitest"
import { layoutMargin, sameTops } from "./margin-layout"

describe("layoutMargin", () => {
	it("keeps notes that do not overlap level with their highlights", () => {
		const tops = layoutMargin(
			[
				{ id: "a", wantedTop: 0, height: 40, start: 0 },
				{ id: "b", wantedTop: 100, height: 40, start: 50 },
			],
			8,
		)
		expect(tops).toEqual(
			new Map([
				["a", 0],
				["b", 100],
			]),
		)
	})

	it("pushes a note below the one above it", () => {
		const tops = layoutMargin(
			[
				{ id: "a", wantedTop: 0, height: 60, start: 0 },
				{ id: "b", wantedTop: 30, height: 40, start: 50 },
				{ id: "c", wantedTop: 90, height: 40, start: 90 },
			],
			8,
		)
		expect(tops.get("b")).toBe(68)
		expect(tops.get("c")).toBe(116)
	})

	it("orders notes on the same line by where their highlight starts", () => {
		const tops = layoutMargin(
			[
				{ id: "later", wantedTop: 10, height: 20, start: 30 },
				{ id: "first", wantedTop: 10, height: 20, start: 5 },
			],
			8,
		)
		expect(tops.get("first")).toBe(10)
		expect(tops.get("later")).toBe(38)
	})

	it("moves later notes down when the open editor is tall", () => {
		const tops = layoutMargin(
			[
				{ id: "editing", wantedTop: 0, height: 200, start: 0 },
				{ id: "next", wantedTop: 50, height: 40, start: 10 },
			],
			8,
		)
		expect(tops.get("next")).toBe(208)
	})
})

describe("sameTops", () => {
	it("ignores moves under half a pixel", () => {
		expect(sameTops(new Map([["a", 10]]), new Map([["a", 10.3]]))).toBe(true)
		expect(sameTops(new Map([["a", 10]]), new Map([["a", 11]]))).toBe(false)
	})

	it("sees an item renamed in place, as a new AI card gets its saved id", () => {
		expect(sameTops(new Map([["tmp-ai-t-1", 448]]), new Map([["01a1", 448]]))).toBe(false)
	})
})
