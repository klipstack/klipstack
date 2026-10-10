import { describe, expect, it } from "vitest"
import { endState, secondsToFinish } from "./reading"

describe("secondsToFinish", () => {
	it("is the part left to read, at three times the reading speed", () => {
		expect(secondsToFinish(12, 0)).toBe(240)
		expect(secondsToFinish(12, 0.5)).toBe(120)
		expect(secondsToFinish(12, 1)).toBe(0)
	})
	it("takes a minute when the reading time is unknown", () => {
		expect(secondsToFinish(null, 0)).toBe(20)
		expect(secondsToFinish(0, 0)).toBe(20)
	})
	it("keeps odd positions in range", () => {
		expect(secondsToFinish(6, -1)).toBe(120)
		expect(secondsToFinish(6, Number.NaN)).toBe(120)
	})
})

describe("endState", () => {
	const base = { finished: false, reachedEnd: true, seconds: 100, needed: 60, kept: false }
	it("finishes on the way out once the end was reached slowly enough", () => {
		expect(endState(base)).toBe("finishing")
	})
	it("waits for the end, and for the time", () => {
		expect(endState({ ...base, reachedEnd: false })).toBe("early")
		expect(endState({ ...base, seconds: 59 })).toBe("early")
	})
	it("leaves finished and kept articles alone", () => {
		expect(endState({ ...base, finished: true })).toBe("finished")
		expect(endState({ ...base, kept: true })).toBe("kept")
	})
})
