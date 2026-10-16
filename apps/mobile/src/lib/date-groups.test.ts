import { describe, expect, it } from "vitest"
import { dateGroup, dateGroupLabel, inSections } from "./date-groups"

// The phone's own days: local times, whatever zone the tests run in.
const now = new Date(2026, 9, 16, 0, 10)
const at = (month: number, day: number, hour = 12, year = 2026) =>
	new Date(year, month - 1, day, hour)

describe("dateGroup", () => {
	it("counts calendar days, not hours", () => {
		expect(dateGroup(at(10, 16, 0), now)).toBe("today")
		// Forty minutes ago, but yesterday.
		expect(dateGroup(new Date(2026, 9, 15, 23, 30), now)).toBe("yesterday")
		expect(dateGroup(at(10, 15, 0), now)).toBe("yesterday")
		expect(dateGroup(at(10, 14, 23), now)).toBe("week")
	})

	it("keeps the last 7 days, then the rest of the month, then months, then years", () => {
		expect(dateGroup(at(10, 10), now)).toBe("week")
		expect(dateGroup(at(10, 9), now)).toBe("month")
		expect(dateGroup(at(10, 1), now)).toBe("month")
		expect(dateGroup(at(9, 30), now)).toBe("month:2026-09")
		expect(dateGroup(at(1, 1), now)).toBe("month:2026-01")
		expect(dateGroup(at(12, 31, 12, 2025), now)).toBe("year:2025")
		// The week reaches into last month before the month groups start.
		expect(dateGroup(at(9, 28), new Date(2026, 9, 2))).toBe("week")
	})

	it("calls a date ahead of the phone's clock today", () => {
		expect(dateGroup(at(10, 17), now)).toBe("today")
	})
})

it("names each group", () => {
	expect(
		["today", "yesterday", "week", "month", "month:2026-09", "month:2026-01", "year:2025"].map(
			dateGroupLabel,
		),
	).toEqual([
		"Today",
		"Yesterday",
		"Last 7 days",
		"Earlier this month",
		"September",
		"January",
		"2025",
	])
})

it("puts a list in sections where the group changes, in the order given", () => {
	const items = [
		{ id: "a", at: at(10, 16, 0).toISOString() },
		{ id: "b", at: null },
		{ id: "c", at: at(10, 15).toISOString() },
		{ id: "d", at: at(8, 2).toISOString() },
		{ id: "e", at: at(8, 1).toISOString() },
	]
	expect(
		inSections(items, (i) => i.at, now).map((s) => [s.title, s.items.map((i) => i.id)]),
	).toEqual([
		// One without a date joins the section before it.
		["Today", ["a", "b"]],
		["Yesterday", ["c"]],
		["August", ["d", "e"]],
	])
	expect(inSections([], (i: { at: string }) => i.at, now)).toEqual([])
})
