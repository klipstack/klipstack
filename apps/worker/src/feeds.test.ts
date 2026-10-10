import { describe, expect, it } from "vitest"
import { FETCH_INTERVAL_MS, MAX_BACKOFF_MS, nextFetchDelay } from "./jobs/feeds"

const HOUR = 3_600_000

describe("nextFetchDelay", () => {
	it("waits the interval after a success", () => {
		expect(nextFetchDelay(0, null, 0.5)).toBe(FETCH_INTERVAL_MS)
	})

	it("doubles per failure, up to a day", () => {
		expect(nextFetchDelay(1, null, 0.5)).toBe(2 * HOUR)
		expect(nextFetchDelay(3, null, 0.5)).toBe(8 * HOUR)
		expect(nextFetchDelay(10, null, 0.5)).toBe(MAX_BACKOFF_MS)
	})

	it("jitters by up to 10% either way", () => {
		expect(nextFetchDelay(0, null, 0)).toBe(54 * 60_000)
		expect(nextFetchDelay(0, null, 1)).toBe(66 * 60_000)
	})

	it("honors Retry-After when it asks for longer", () => {
		expect(nextFetchDelay(1, 5 * 3600, 0.5)).toBe(5 * HOUR)
		expect(nextFetchDelay(1, 60, 0.5)).toBe(2 * HOUR)
		expect(nextFetchDelay(1, 7 * 24 * 3600, 0.5)).toBe(MAX_BACKOFF_MS)
	})
})
