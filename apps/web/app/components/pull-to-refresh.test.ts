import { describe, expect, it } from "vitest"
import { IDLE, type Pull, type PullEvent, transition } from "./pull-to-refresh"

const after = (...events: PullEvent[]) => events.reduce(transition, IDLE as Pull)

describe("pull to refresh", () => {
	it("follows the finger at half its distance, up to a limit", () => {
		expect(after({ type: "moved", dy: 40 })).toEqual({ phase: "pulling", height: 20 })
		expect(after({ type: "moved", dy: 400 })).toEqual({ phase: "pulling", height: 96 })
	})

	it("refreshes when let go past the threshold, and not short of it", () => {
		expect(after({ type: "moved", dy: 128 }, { type: "released" })).toEqual({
			phase: "refreshing",
		})
		expect(after({ type: "moved", dy: 126 }, { type: "released" })).toBe(IDLE)
	})

	it("drops the pull when the finger goes back above where it touched", () => {
		expect(after({ type: "moved", dy: 200 }, { type: "moved", dy: -5 }, { type: "released" })).toBe(
			IDLE,
		)
	})

	it("ignores the finger while refreshing, until the refresh settles", () => {
		const refreshing = after({ type: "moved", dy: 200 }, { type: "released" })
		expect(transition(refreshing, { type: "moved", dy: 300 })).toBe(refreshing)
		expect(transition(refreshing, { type: "released" })).toBe(refreshing)
		expect(transition(refreshing, { type: "settled" })).toBe(IDLE)
	})
})
