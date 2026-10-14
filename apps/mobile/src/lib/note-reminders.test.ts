import { describe, expect, it } from "vitest"
import { finishedLabel } from "./note-reminders"

describe("finishedLabel", () => {
	const now = new Date(2026, 9, 14, 0, 30)

	it("counts calendar days, not hours: late last night is yesterday", () => {
		const lastNight = new Date(2026, 9, 13, 23, 50).toISOString()
		expect(finishedLabel({ finishedAt: lastNight, listened: false }, now)).toBe(
			"Finished yesterday",
		)
		const earlier = new Date(2026, 9, 14, 0, 5).toISOString()
		expect(finishedLabel({ finishedAt: earlier, listened: true }, now)).toBe("Listened to today")
	})

	it("says days ago after that", () => {
		const before = new Date(2026, 9, 11, 9).toISOString()
		expect(finishedLabel({ finishedAt: before, listened: true }, now)).toBe(
			"Listened to 3 days ago",
		)
	})
})
