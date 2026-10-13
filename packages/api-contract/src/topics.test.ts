import { describe, expect, it } from "vitest"
import { somethingDifferent } from "./topics"

const topic = (id: string, toRead: number, lastReadAt: string | Date | null) => ({
	id,
	name: id,
	toRead,
	lastReadAt,
})

describe("somethingDifferent", () => {
	it("offers the topic read from least lately, one never read from first", () => {
		expect(
			somethingDifferent([
				topic("Writing", 5, "2026-10-10T00:00:00Z"),
				topic("Science", 3, "2026-09-01T00:00:00Z"),
				topic("Startups", 1, "2026-10-01T00:00:00Z"),
			]),
		).toBe("Science")
		expect(
			somethingDifferent([topic("Writing", 5, "2026-10-10T00:00:00Z"), topic("History", 1, null)]),
		).toBe("History")
	})

	it("breaks ties by more to read, then by name", () => {
		expect(somethingDifferent([topic("B", 1, null), topic("C", 4, null)])).toBe("C")
		expect(somethingDifferent([topic("B", 2, null), topic("A", 2, null)])).toBe("A")
	})

	it("takes dates as strings or dates alike", () => {
		expect(
			somethingDifferent([
				topic("Old", 1, new Date("2026-01-01T00:00:00Z")),
				topic("New", 1, "2026-06-01T00:00:00Z"),
			]),
		).toBe("Old")
	})

	it("offers only topics with something to read, and nothing with fewer than two of them", () => {
		expect(somethingDifferent([topic("Done", 0, null), topic("Writing", 2, "2026-10-10")])).toBe(
			null,
		)
		expect(somethingDifferent([topic("Writing", 2, null)])).toBeNull()
		expect(somethingDifferent([])).toBeNull()
		expect(
			somethingDifferent([
				topic("Done", 0, null),
				topic("A", 1, "2026-10-10"),
				topic("B", 1, "2026-10-01"),
			]),
		).toBe("B")
	})
})
