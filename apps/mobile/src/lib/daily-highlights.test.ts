import { afterEach, describe, expect, it } from "vitest"
import { localDay } from "./daily-highlights"

describe("localDay", () => {
	const zone = process.env.TZ
	afterEach(() => {
		process.env.TZ = zone
	})

	it("is the device's date at either end of its day, whatever the date is in UTC", () => {
		// Madrid is UTC+2 in October: 00:30 there is still the 15th in UTC.
		process.env.TZ = "Europe/Madrid"
		expect(localDay(new Date("2026-10-15T22:30:00Z"))).toBe("2026-10-16")
		// New York is UTC-5 in January: 23:30 there is already the 2nd in UTC.
		process.env.TZ = "America/New_York"
		expect(localDay(new Date("2027-01-02T04:30:00Z"))).toBe("2027-01-01")
	})
})
