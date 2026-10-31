import { describe, expect, it } from "vitest"
import { amounts, dayName, heatLevel, periodLabel, total, yearWeeks } from "./reading"

describe("yearWeeks", () => {
	it("cuts the year into columns from Monday, this week's last and only as far as today", () => {
		// 2025-11-03 is a Monday; 2026-10-31 a Saturday.
		const weeks = yearWeeks("2025-11-03", "2026-10-31")
		expect(weeks).toHaveLength(52)
		expect(weeks[0]).toEqual([
			"2025-11-03",
			"2025-11-04",
			"2025-11-05",
			"2025-11-06",
			"2025-11-07",
			"2025-11-08",
			"2025-11-09",
		])
		expect(weeks.at(-1)).toEqual([
			"2026-10-26",
			"2026-10-27",
			"2026-10-28",
			"2026-10-29",
			"2026-10-30",
			"2026-10-31",
		])
		expect(weeks.flat()).toHaveLength(52 * 7 - 1)
	})

	it("keeps whole days across a change of clocks", () => {
		// Europe's clocks change on 2026-03-29, Chile's on 2026-04-05: a day is still a day.
		const days = yearWeeks("2026-03-23", "2026-04-12").flat()
		expect(days).toHaveLength(21)
		expect(new Set(days).size).toBe(21)
	})
})

describe("heatLevel", () => {
	it("deepens with the articles of a day, as the web's grid does", () => {
		expect([0, 1, 2, 3, 4, 9].map(heatLevel)).toEqual([0, 1, 2, 2, 3, 3])
	})
})

describe("amounts", () => {
	it("says minutes under an hour, then hours and minutes", () => {
		expect(amounts.minutes(59)).toBe("about 59 min")
		expect(amounts.minutes(60)).toBe("about 1 h")
		expect(amounts.minutes(61)).toBe("about 1 h 1 min")
		expect(amounts.minutes(185)).toBe("about 3 h 5 min")
	})

	it("counts articles and words with the language's digits", () => {
		expect(amounts.articles(1)).toBe("1 article")
		expect(amounts.articles(1200)).toBe("1,200 articles")
		expect(amounts.words(1)).toBe("1 word")
		expect(amounts.words(31240)).toBe("31,240 words")
	})
})

describe("total", () => {
	it("says the length and the book outgrown, only once there is something", () => {
		expect(total({ articles: 0, words: 0, minutes: 0 })).toEqual({
			articles: "0 articles",
			length: null,
			book: null,
		})
		expect(total({ articles: 3, words: 31240, minutes: 129 })).toEqual({
			articles: "3 articles",
			length: "31,240 words · about 2 h 9 min",
			book: "Longer than The Old Man and the Sea",
		})
		// No reading time known: the words alone.
		expect(total({ articles: 1, words: 800, minutes: 0 })).toMatchObject({
			length: "800 words",
			book: null,
		})
	})
})

describe("dayName", () => {
	it("names the day itself, wherever the phone is", () => {
		// Parsed as a time, the first of the month would be the day before west of UTC.
		expect(dayName("2026-03-01", "long")).toBe("March 1, 2026")
		expect(dayName("2026-03-01", "short")).toBe("Mar 1")
		expect(dayName("2026-03-01", "month")).toBe("March")
		expect(dayName("2026-03-01", "monthShort")).toBe("Mar")
		expect(dayName("2026-03-01", "monthYear")).toBe("March 2026")
	})
})

describe("periodLabel", () => {
	const weeks = ["2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"]
	it("names a week by its Monday, with the month where one starts", () => {
		expect(weeks.map((_, i) => periodLabel(weeks, i, "week"))).toEqual([
			{ top: "21", bottom: "Sep", name: "Week of Sep 21" },
			{ top: "28", bottom: "", name: "Week of Sep 28" },
			{ top: "5", bottom: "Oct", name: "Week of Oct 5" },
			{ top: "12", bottom: "", name: "Week of Oct 12" },
		])
	})

	it("names a month by its name", () => {
		expect(periodLabel(["2026-09-01", "2026-10-01"], 1, "month")).toEqual({
			top: "Oct",
			bottom: "",
			name: "October 2026",
		})
	})
})
