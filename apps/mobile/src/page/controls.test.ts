import { describe, expect, it } from "vitest"
import { type ControlsState, controlsStep } from "./controls"

describe("controlsStep", () => {
	const scroll = (ys: number[], start: ControlsState = { shown: true, from: ys[0]! }) =>
		ys.reduce((state, y) => controlsStep(state, y, 5000), start).shown

	it("hides the controls once the page has gone 24 points down", () => {
		expect(scroll([1000, 1010, 1020])).toBe(true)
		expect(scroll([1000, 1010, 1030])).toBe(false)
	})

	it("shows them once the page has come 24 points back up from its lowest point", () => {
		const hidden = { shown: false, from: 1000 }
		expect(scroll([1200, 1180], hidden)).toBe(false)
		expect(scroll([1200, 1170], hidden)).toBe(true)
	})

	it("measures from the turn, so small movements don't flicker them", () => {
		expect(scroll([1000, 990, 980, 1000])).toBe(true)
		expect(scroll([1000, 990, 980, 1010])).toBe(false)
	})

	it("shows them near the top", () => {
		expect(controlsStep({ shown: false, from: 300 }, 30, 5000).shown).toBe(true)
	})

	it("ignores the bounce past either end", () => {
		const hidden = { shown: false, from: 5000 }
		expect(controlsStep(hidden, 5060, 5000)).toBe(hidden)
		expect(controlsStep({ shown: true, from: 50 }, -40, 5000).shown).toBe(true)
	})
})
