import { describe, expect, it } from "vitest"
import { dateGroup, dateGroupLabel, formatDay, timeZoneFromCookie } from "./date-groups"

const now = new Date("2026-09-14T15:00:00Z")
const group = (iso: string, zone = "UTC") => dateGroup(new Date(iso), now, zone)

describe("dateGroup", () => {
	it("names the recent days", () => {
		expect(group("2026-09-14T00:10:00Z")).toBe("today")
		expect(group("2026-09-13T23:59:00Z")).toBe("yesterday")
		expect(group("2026-09-08T12:00:00Z")).toBe("week")
		expect(group("2026-09-07T12:00:00Z")).toBe("month")
	})
	it("uses months this year and years before", () => {
		expect(group("2026-08-31T12:00:00Z")).toBe("month:2026-08")
		expect(group("2026-01-01T12:00:00Z")).toBe("month:2026-01")
		expect(group("2025-12-31T12:00:00Z")).toBe("year:2025")
	})
	it("counts days in the reader's time zone", () => {
		// 01:00 UTC on the 14th is still the 13th in Buenos Aires (UTC-3)
		expect(group("2026-09-14T01:00:00Z", "America/Argentina/Buenos_Aires")).toBe("yesterday")
		expect(group("2026-09-14T01:00:00Z", "UTC")).toBe("today")
	})
	it("never goes into the future", () => {
		expect(group("2026-09-15T12:00:00Z")).toBe("today")
	})
})

describe("dateGroupLabel", () => {
	const named = (key: string) => key.toUpperCase()
	it("formats months and years for the language", () => {
		expect(dateGroupLabel("month:2026-08", "en", named)).toBe("August")
		expect(dateGroupLabel("month:2026-08", "es", named)).toBe("Agosto")
		expect(dateGroupLabel("year:2025", "en", named)).toBe("2025")
		expect(dateGroupLabel("today", "en", named)).toBe("TODAY")
	})
})

describe("formatDay", () => {
	it("gives the day in the reader's zone and language", () => {
		const late = "2026-09-27T02:00:00Z"
		expect(formatDay(late, "en", "UTC")).toBe("Sep 27, 2026")
		expect(formatDay(late, "en", "America/Santiago")).toBe("Sep 26, 2026")
		expect(formatDay(late, "es", "UTC")).toBe("27 sept 2026")
	})
})

describe("timeZoneFromCookie", () => {
	it("takes zone names only: Postgres reads an offset with its sign flipped", () => {
		expect(timeZoneFromCookie("klip_tz=%2B01%3A00")).toBe("UTC")
		expect(timeZoneFromCookie("klip_tz=Etc%2FGMT%2B3")).toBe("Etc/GMT+3")
	})

	it("reads a valid zone and falls back to UTC", () => {
		expect(timeZoneFromCookie("a=1; klip_tz=Europe%2FMadrid")).toBe("Europe/Madrid")
		expect(timeZoneFromCookie("klip_tz=Not/AZone")).toBe("UTC")
		expect(timeZoneFromCookie(null)).toBe("UTC")
	})
})
