import type { Usage } from "@klipstack/api-contract"
import { describe, expect, it } from "vitest"
import { resetsOn, usageRows } from "./usage"

const MB = 1024 * 1024

const usage: Usage = {
	saves: { used: 1234, max: 1500 },
	storage: { used: 1.6 * MB, max: 2048 * MB },
	feeds: { used: 50, max: 50 },
	editions: { used: 0, max: 0 },
	ai: { used: 12, max: 50 },
	topicSorts: null,
	resetsAt: "2026-11-01T00:00:00.000Z",
}

describe("usageRows", () => {
	it("lists each cap the account has, with how full it is", () => {
		expect(usageRows(usage)).toEqual([
			{
				key: "saves",
				label: "Saves",
				amount: "1,234 of 1,500",
				left: null,
				share: 1234 / 1500,
				level: "near",
			},
			{
				key: "ai",
				label: "AI questions",
				amount: "12 of 50",
				left: "38 left",
				share: 0.24,
				level: "ok",
			},
			// A cap of none allows nothing: full, not empty.
			{
				key: "editions",
				label: "Editions published",
				amount: "0 of 0",
				left: null,
				share: 1,
				level: "full",
			},
			{
				key: "storage",
				label: "Storage",
				amount: "1.6 of 2,048 MB",
				left: null,
				share: 1.6 / 2048,
				level: "ok",
			},
			{
				key: "feeds",
				label: "Feeds followed",
				amount: "50 of 50",
				left: null,
				share: 1,
				level: "full",
			},
		])
	})

	it("shows topic sorting only when the account sorts, and never more than full", () => {
		const rows = usageRows({ ...usage, ai: null, topicSorts: { used: 1200, max: 1000 } })
		expect(rows.map((r) => r.key)).toEqual(["saves", "topicSorts", "editions", "storage", "feeds"])
		expect(rows[1]).toMatchObject({ amount: "1,200 of 1,000", share: 1, level: "full" })
	})

	it("shows a small library's storage to a tenth of a megabyte", () => {
		const storage = (bytes: number) =>
			usageRows({ ...usage, storage: { used: bytes, max: 250 * MB } }).find(
				(r) => r.key === "storage",
			)?.amount
		expect(storage(0)).toBe("0 of 250 MB")
		expect(storage(0.01 * MB)).toBe("0.1 of 250 MB")
		expect(storage(12.4 * MB)).toBe("12 of 250 MB")
	})

	it("says nothing is left past the cap", () => {
		expect(usageRows({ ...usage, ai: { used: 60, max: 50 } })[1]?.left).toBe("0 left")
	})
})

describe("resetsOn", () => {
	it("is the day in UTC, whatever the phone's zone", () => {
		expect(resetsOn("2026-11-01T00:00:00.000Z")).toBe("November 1")
		expect(resetsOn("2027-01-01T00:00:00.000Z")).toBe("January 1")
	})
})
