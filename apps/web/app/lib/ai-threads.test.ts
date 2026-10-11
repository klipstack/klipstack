import { describe, expect, it } from "vitest"
import { questionsLeft } from "./ai-threads"

const at = (used: number, max = 100) => ({ used, max, resetsAt: "2026-11-01T00:00:00.000Z" })

describe("questionsLeft", () => {
	it("says how many are left only from a fifth of the cap down, and when none are", () => {
		expect(questionsLeft(at(79))).toEqual({ left: 21, few: false, none: false })
		expect(questionsLeft(at(80))).toEqual({ left: 20, few: true, none: false })
		expect(questionsLeft(at(99))).toEqual({ left: 1, few: true, none: false })
		expect(questionsLeft(at(100))).toEqual({ left: 0, few: false, none: true })
		// A cap lowered below what was already asked.
		expect(questionsLeft(at(120))).toEqual({ left: 0, few: false, none: true })
		expect(questionsLeft(at(399, 500))).toMatchObject({ left: 101, few: false })
		expect(questionsLeft(at(400, 500))).toMatchObject({ left: 100, few: true })
	})

	it("says nothing without AI", () => {
		expect(questionsLeft(null)).toEqual({ left: Infinity, few: false, none: false })
	})
})
