import type { ArticleSummary } from "@klipstack/sdk"
import { describe, expect, it } from "vitest"
import { homeSections, minutesLeft, withChanges } from "./home"

const article = (id: string, status: ArticleSummary["status"] = "ready") =>
	({ id, status }) as ArticleSummary
const ids = (items: ArticleSummary[]) => items.map((a) => a.id)

const none = { reading: [], unread: [], rediscover: [], fits: [] }

describe("homeSections", () => {
	it("puts the article read last in the big card, then the rest of each list", () => {
		const home = homeSections(
			{
				reading: [article("r1"), article("r2")],
				unread: [article("u1"), article("u2")],
				rediscover: [article("o1")],
				fits: [article("f1")],
			},
			{ minutes: 30 },
		)
		expect(home.hero?.id).toBe("r1")
		expect(ids(home.reading)).toEqual(["r2"])
		expect(ids(home.recent)).toEqual(["u1", "u2"])
		expect(ids(home.rediscover)).toEqual(["o1"])
		expect(home.fits?.minutes).toBe(30)
		expect(ids(home.fits!.items)).toEqual(["f1"])
	})

	it("gives the big card to the newest save when nothing is in progress", () => {
		const home = homeSections({ ...none, unread: [article("u1"), article("u2")] })
		expect(home.hero?.id).toBe("u1")
		expect(ids(home.recent)).toEqual(["u2"])
	})

	it("shows each article once and only ready ones", () => {
		const home = homeSections({
			reading: [article("a")],
			unread: [article("a"), article("b"), article("p", "processing")],
			rediscover: [article("b"), article("c")],
			fits: [article("b"), article("c"), article("d"), article("f", "failed")],
		})
		expect(ids(home.recent)).toEqual(["b"])
		expect(ids(home.rediscover)).toEqual(["c"])
		expect(ids(home.fits!.items)).toEqual(["d"])
	})

	it("fills a shelf up to its size", () => {
		const many = Array.from({ length: 12 }, (_, i) => article(`f${i}`))
		expect(homeSections({ ...none, fits: many }).fits?.items).toHaveLength(8)
	})

	it("keeps the time choices while the longest time has something not shown above", () => {
		expect(homeSections({ ...none, fits: [] }).fits).toBeNull()
		const shown = { ...none, unread: [article("u1")] }
		expect(homeSections({ ...shown, longest: [article("u1")] }).fits).toBeNull()
		expect(homeSections({ ...shown, longest: [article("long")] }, { minutes: 5 }).fits).toEqual({
			minutes: 5,
			items: [],
		})
	})

	it("has nothing for an empty library", () => {
		expect(homeSections(none)).toEqual({
			hero: null,
			reading: [],
			recent: [],
			rediscover: [],
			fits: null,
		})
	})
})

describe("minutesLeft", () => {
	it("rounds up what is left, and says at least a minute", () => {
		expect(minutesLeft({ readingMinutes: 20, progress: 0.5 })).toBe(10)
		expect(minutesLeft({ readingMinutes: 7, progress: 0.5 })).toBe(4)
		expect(minutesLeft({ readingMinutes: 5, progress: 0.99 })).toBe(1)
		expect(minutesLeft({ readingMinutes: null, progress: 0.5 })).toBeNull()
	})
})

describe("withChanges", () => {
	const inbox = (id: string, fields: Partial<ArticleSummary> = {}) =>
		({
			id,
			status: "ready",
			location: "inbox",
			trashedAt: null,
			starred: false,
			...fields,
		}) as ArticleSummary
	const home = {
		hero: inbox("h"),
		reading: [inbox("r")],
		recent: [inbox("a"), inbox("b")],
		rediscover: [inbox("o")],
		fits: { minutes: 15, items: [inbox("f")] },
	}

	it("shows a change where the article is", () => {
		const next = withChanges(home, new Map([["a", inbox("a", { starred: true })]]))
		expect(next.recent[0]?.starred).toBe(true)
		expect(ids(next.recent)).toEqual(["a", "b"])
	})

	it("drops what left the library", () => {
		const next = withChanges(
			home,
			new Map([
				["h", inbox("h", { location: "archive" })],
				["b", inbox("b", { trashedAt: "2026-09-27T10:00:00.000Z" })],
				["f", inbox("f", { location: "archive" })],
			]),
		)
		expect(next.hero).toBeNull()
		// The time choices stay, with nothing in them until Home loads again.
		expect(next.fits).toEqual({ minutes: 15, items: [] })
		expect(ids(next.rediscover)).toEqual(["o"])
		expect(ids(next.recent)).toEqual(["a"])
		expect(ids(next.reading)).toEqual(["r"])
	})
})
