import { describe, expect, it } from "vitest"
import { fillsTime, fitsIn, homeShelves, shortTitle, TIME_FILTER_MIN } from "./home-shelves"

const recentSince = new Date("2026-09-26T00:00:00Z")
const lately = new Date("2026-10-09T00:00:00Z")
const longAgo = new Date("2026-08-01T00:00:00Z")
const doc = (id: string, minutesLeft: number | null, createdAt = lately) => ({
	id,
	minutesLeft,
	createdAt,
})
const ids = (docs: { id: string }[]) => docs.map((d) => d.id)
const none = { reading: [], recent: [], rediscover: [], recentSince }

describe("homeShelves", () => {
	it("narrows each section to what fits, in its own order", () => {
		const candidates = {
			reading: [doc("r20", 20), doc("r4", 4)],
			recent: [doc("n30", 30), doc("n5", 5), doc("post", null), doc("n2", 2)],
			rediscover: [doc("o10", 10, longAgo), doc("o3", 3, longAgo)],
			recentSince,
		}
		expect(homeShelves(candidates, null)).toEqual({
			reading: candidates.reading,
			recent: candidates.recent.slice(0, 3),
			rediscover: candidates.rediscover,
		})
		const five = homeShelves(candidates, 5)
		expect(ids(five.reading)).toEqual(["r4"])
		expect(ids(five.recent)).toEqual(["n5", "n2"])
		expect(ids(five.rediscover)).toEqual(["o3"])
	})

	it("puts what fills at least half the time first: more time, longer articles", () => {
		const recent = [doc("new3", 3), doc("new12", 12), doc("new50", 50), doc("new30", 30)]
		const at = (minutes: number) => ids(homeShelves({ ...none, recent }, minutes).recent)
		expect(at(5)).toEqual(["new3"])
		expect(at(15)).toEqual(["new12", "new3"])
		expect(at(30)).toEqual(["new30", "new3", "new12"])
		expect(at(60)).toEqual(["new50", "new30", "new3", "new12"])
	})

	it("keeps Recently saved to recent saves once a time is chosen", () => {
		const recent = [doc("new5", 5), doc("old50", 50, longAgo), doc("old4", 4, longAgo)]
		expect(ids(homeShelves({ ...none, recent }, null).recent)).toEqual(["new5", "old50", "old4"])
		expect(ids(homeShelves({ ...none, recent }, 60).recent)).toEqual(["new5"])
	})

	it("keeps the article read last when nothing started can be finished in the time", () => {
		const candidates = { ...none, reading: [doc("last", 40), doc("earlier", 25)] }
		expect(ids(homeShelves(candidates, 5).reading)).toEqual(["last"])
		expect(ids(homeShelves(candidates, 30).reading)).toEqual(["earlier"])
		expect(homeShelves(none, 5).reading).toEqual([])
	})

	it("shows each article once, the first section that has it keeping it", () => {
		const shelves = homeShelves(
			{ ...none, recent: [doc("a", 5), doc("b", 5)], rediscover: [doc("b", 5), doc("c", 5)] },
			null,
		)
		expect(ids(shelves.recent)).toEqual(["a", "b"])
		expect(ids(shelves.rediscover)).toEqual(["c"])
	})
})

describe("fitsIn and fillsTime", () => {
	it("counts what has no time only when any length goes", () => {
		expect(fitsIn(doc("post", null), null)).toBe(true)
		expect(fitsIn(doc("post", null), 60)).toBe(false)
		expect(fitsIn(doc("a", 15), 15)).toBe(true)
		expect(fitsIn(doc("a", 16), 15)).toBe(false)
	})

	it("fills the time from half of it up to all of it", () => {
		expect(fillsTime(doc("a", 29), 60)).toBe(false)
		expect(fillsTime(doc("a", 30), 60)).toBe(true)
		expect(fillsTime(doc("a", 60), 60)).toBe(true)
		expect(fillsTime(doc("a", 61), 60)).toBe(false)
		expect(fillsTime(doc("a", 3), 5)).toBe(true)
		expect(fillsTime(doc("post", null), 60)).toBe(false)
	})
})

describe("TIME_FILTER_MIN", () => {
	it("is the most library articles Home shows at once", () => {
		const many = (prefix: string) => Array.from({ length: 20 }, (_, i) => doc(`${prefix}${i}`, 5))
		const full = homeShelves(
			{ reading: many("r"), recent: many("n"), rediscover: many("o"), recentSince },
			null,
		)
		const shown = full.reading.length + full.recent.length + full.rediscover.length
		expect(shown).toBe(TIME_FILTER_MIN)
	})
})

describe("shortTitle", () => {
	it("keeps a title that fits", () => {
		expect(shortTitle("How to Read a Book", 20)).toBe("How to Read a Book")
	})
	it("cuts a long title after a word, within the length", () => {
		expect(shortTitle("The quiet pleasures of reading slowly in a hurried age", 30)).toBe(
			"The quiet pleasures of…",
		)
	})
	it("cuts at the length when the only space is early, not after one word", () => {
		expect(shortTitle("Unread extraordinarily long", 20)).toBe("Unread extraordinar…")
	})
	it("never cuts a character in half", () => {
		expect(shortTitle("読書の楽しみ📚と静かな時間", 8)).toBe("読書の楽しみ📚…")
	})
	it("cuts a title without spaces at the length", () => {
		expect(shortTitle("Donaudampfschifffahrtsgesellschaft", 10)).toBe("Donaudamp…")
	})
})
