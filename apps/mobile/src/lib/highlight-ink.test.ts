import { describe, expect, it } from "vitest"
import {
	INK_DROP,
	INK_HEIGHT,
	inkCrossings,
	inkLines,
	inkStroke,
	randomFrom,
} from "./highlight-ink"

const rect = (left: number, top: number, right: number, bottom: number) => ({
	left,
	top,
	right,
	bottom,
})

describe("inkLines", () => {
	it("joins the rectangles of one line, keeps lines apart and skips empty ones", () => {
		const lines = inkLines([
			rect(100, 10, 200, 30),
			// Bold or a link on the same line, a little taller.
			rect(200, 8, 260, 31),
			// The end of a line, and an empty one: nothing to paint.
			rect(260, 10, 260, 30),
			rect(40, 100, 40, 120),
			rect(40, 40, 300, 60),
			rect(40, 70, 120, 90),
		])
		expect(lines).toEqual([rect(100, 8, 260, 31), rect(40, 40, 300, 60), rect(40, 70, 120, 90)])
	})
})

describe("inkStroke", () => {
	const line = rect(140, 220, 540, 240)
	const origin = { left: 40, top: 20 }

	it("is 80% as tall as the text, low in it, and a little longer than it", () => {
		const s = inkStroke(line, origin, "h1", 0)
		expect(INK_HEIGHT).toBe(0.8)
		expect(INK_DROP).toBe(0.9)
		expect(s.height).toBeCloseTo(16)
		const top = 200 + (20 - 16) * INK_DROP
		expect(Math.abs(s.top - top)).toBeLessThan(16 * 0.03 + 1e-9)
		// The tops of tall letters stand above it; it reaches the bottom of the text.
		expect(s.top).toBeGreaterThan(200 + 2)
		expect(s.top + s.height).toBeGreaterThan(220 - 1)
		expect(s.left).toBeLessThan(100)
		expect(s.left).toBeGreaterThan(100 - 16 * 0.2)
		expect(s.left + s.width).toBeGreaterThan(500)
		expect(s.left + s.width).toBeLessThan(500 + 16 * 0.25)
		expect(Math.abs(s.tilt)).toBeLessThanOrEqual(0.35)
		expect(s.line).toBe(0)
	})

	it("keeps its shape for the same highlight and line, and varies from line to line", () => {
		expect(inkStroke(line, origin, "h1", 2)).toEqual(inkStroke(line, origin, "h1", 2))
		const shapes = new Set(
			[0, 1, 2, 3].map((i) => {
				const { radius, tilt } = inkStroke(line, origin, "h1", i)
				return `${radius} ${tilt}`
			}),
		)
		expect(shapes.size).toBe(4)
		expect(inkStroke(line, origin, "h2", 0).radius).not.toBe(
			inkStroke(line, origin, "h1", 0).radius,
		)
	})
})

describe("inkCrossings", () => {
	const stroke = (line: number, left: number, top: number, width: number) => ({
		line,
		left,
		top,
		width,
		height: 16,
		tilt: 0,
		radius: "0",
		corners: [0, 0, 0, 0] as [number, number, number, number],
	})

	it("finds where two highlights' strokes lie on each other, line by line", () => {
		const crossings = inkCrossings([
			{ key: "a", color: "yellow", strokes: [stroke(0, 0, 100, 400), stroke(1, 0, 130, 300)] },
			// From the middle of the first line to the start of the second.
			{ key: "b", color: "pink", strokes: [stroke(0, 250, 101, 200), stroke(1, 0, 131, 80)] },
			// On the third line alone, and its own strokes never cross each other.
			{ key: "c", color: "blue", strokes: [stroke(0, 0, 160, 50), stroke(1, 40, 160, 50)] },
		])
		expect(crossings).toEqual([
			{ left: 250, top: 101, width: 150, height: 15, colors: ["yellow", "pink"], keys: ["a", "b"] },
			{ left: 0, top: 131, width: 80, height: 15, colors: ["yellow", "pink"], keys: ["a", "b"] },
		])
	})

	it("finds none where strokes only touch, or none cross", () => {
		expect(
			inkCrossings([
				{ key: "a", color: "yellow", strokes: [stroke(0, 0, 100, 100)] },
				{ key: "b", color: "green", strokes: [stroke(0, 100, 100, 100)] },
			]),
		).toEqual([])
		expect(inkCrossings([])).toEqual([])
	})
})

describe("randomFrom", () => {
	it("repeats for a seed and stays in [0, 1)", () => {
		const a = randomFrom("seed")
		const b = randomFrom("seed")
		const values = Array.from({ length: 200 }, () => a())
		expect(values).toEqual(Array.from({ length: 200 }, () => b()))
		expect(values.every((v) => v >= 0 && v < 1)).toBe(true)
		expect(new Set(values.map((v) => Math.floor(v * 10))).size).toBe(10)
	})
})
