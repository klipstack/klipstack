import { describe, expect, it } from "vitest"
import { lineBoxes } from "./line-boxes"

const rect = (left: number, top: number, width: number, height: number) => ({
	left,
	top,
	width,
	height,
	right: left + width,
	bottom: top + height,
})

describe("lineBoxes", () => {
	it("joins the rectangles of one line, and moves them by the scroll", () => {
		const boxes = lineBoxes([rect(10, 100, 50, 20), rect(60, 102, 30, 16), rect(10, 130, 80, 20)], {
			x: 0,
			y: 500,
		})
		expect(boxes).toEqual([
			{ left: 10, top: 600, width: 80, height: 20 },
			{ left: 10, top: 630, width: 80, height: 20 },
		])
	})

	it("skips empty rectangles", () => {
		expect(lineBoxes([rect(10, 100, 0, 20), rect(10, 100, 40, 0)], { x: 0, y: 0 })).toEqual([])
	})
})
