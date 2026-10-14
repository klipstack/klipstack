import type { ArticleSummary } from "@klipstack/sdk"
import { describe, expect, it } from "vitest"
import { everyHomeArticle, homeSections, minutesLeft, offersTimeChoice, withChanges } from "./home"

const article = (id: string, status: ArticleSummary["status"] = "ready") =>
	({ id, status }) as ArticleSummary
const ids = (items: ArticleSummary[]) => items.map((a) => a.id)

describe("homeSections", () => {
	it("puts the article read last in the big card, then the rest of each list", () => {
		const home = homeSections({
			reading: [article("r1"), article("r2")],
			unread: [article("u1"), article("u2")],
			quick: [article("q1")],
			long: [article("l1")],
		})
		expect(home.hero?.id).toBe("r1")
		expect(ids(home.reading)).toEqual(["r2"])
		expect(ids(home.recent)).toEqual(["u1", "u2"])
		expect(ids(home.quick)).toEqual(["q1"])
	})

	it("gives the big card to the newest save when nothing is in progress", () => {
		const home = homeSections({
			reading: [],
			unread: [article("u1"), article("u2")],
			quick: [],
			long: [],
		})
		expect(home.hero?.id).toBe("u1")
		expect(ids(home.recent)).toEqual(["u2"])
	})

	it("shows each article once and only ready ones", () => {
		const home = homeSections({
			reading: [article("a")],
			unread: [article("a"), article("b"), article("p", "processing")],
			quick: [article("b"), article("c"), article("f", "failed")],
			long: [],
		})
		expect(ids(home.recent)).toEqual(["b"])
		expect(ids(home.quick)).toEqual(["c"])
	})

	it("fills a shelf up to its size", () => {
		const many = Array.from({ length: 12 }, (_, i) => article(`q${i}`))
		expect(homeSections({ reading: [], unread: [], quick: many, long: [] }).quick).toHaveLength(8)
	})

	it("has nothing for an empty library", () => {
		expect(homeSections({ reading: [], unread: [], quick: [], long: [] })).toEqual({
			hero: null,
			reading: [],
			recent: [],
			quick: [],
			pickUp: false,
			nothingFits: false,
		})
	})
})

describe("homeSections with a time chosen", () => {
	// `left` minutes to go: a whole article unread, or one minute read of `left + 1`.
	const timed = (id: string, left: number | null, fields: Partial<ArticleSummary> = {}) =>
		({
			id,
			status: "ready",
			readingMinutes: left,
			progress: 0,
			savedAt: "2026-10-01T10:00:00.000Z",
			...fields,
		}) as ArticleSummary
	const none = { reading: [], unread: [], quick: [], long: [] }

	it("keeps in each section only what can be finished in the time", () => {
		const home = homeSections(
			{
				reading: [
					timed("r-long", 40, { progress: 0.5 }), // 20 left: doesn't fit in 15
					timed("r-fits", 30, { progress: 0.6 }), // 12 left: fits
				],
				unread: [timed("u-16", 16), timed("u-15", 15), timed("u-none", null)],
				quick: [timed("q-3", 3), timed("q-10", 10)],
				long: [],
			},
			{ minutes: 15 },
		)
		expect(home.hero?.id).toBe("r-fits")
		expect(home.pickUp).toBe(false)
		expect(ids(home.recent)).toEqual(["u-15"])
		// At least half the time first: 10 of 15 before 3.
		expect(ids(home.quick)).toEqual(["q-10", "q-3"])
		expect(home.nothingFits).toBe(false)
	})

	it("changes nothing without a time", () => {
		const lists = {
			reading: [timed("r", 40)],
			unread: [timed("u-60", 60), timed("u-2", 2)],
			quick: [timed("q", 2)],
			long: [timed("l", 90)],
		}
		const home = homeSections(lists, { minutes: null })
		expect(home.hero?.id).toBe("r")
		expect(ids(home.recent)).toEqual(["u-60", "u-2"])
	})

	it("brings longer saves up with more time, from the long reads too, newest first", () => {
		const home = homeSections(
			{
				...none,
				unread: [
					timed("u-5", 5, { savedAt: "2026-10-12T10:00:00.000Z" }),
					timed("u-45", 45, { savedAt: "2026-10-11T10:00:00.000Z" }),
				],
				long: [
					timed("l-50", 50, { savedAt: "2026-09-01T10:00:00.000Z" }),
					timed("u-45", 45, { savedAt: "2026-10-11T10:00:00.000Z" }),
					timed("l-90", 90, { savedAt: "2026-09-20T10:00:00.000Z" }),
					// Saved last, though the list has it last: it comes first of those not filling half.
					timed("l-20", 20, { savedAt: "2026-10-13T10:00:00.000Z" }),
				],
			},
			{ minutes: 60 },
		)
		// u-45 is the big card; then those that fill half the hour, then the rest, newest first.
		expect(home.hero?.id).toBe("u-45")
		expect(ids(home.recent)).toEqual(["l-50", "l-20", "u-5"])
	})

	it("counts exactly half the time as filling it", () => {
		const home = homeSections(
			{ ...none, unread: [timed("u-5", 5), timed("u-15", 15)] },
			{ minutes: 30 },
		)
		expect(home.hero?.id).toBe("u-15")
	})

	it("leaves long reads already started to Continue reading", () => {
		const started = timed("l-started", 40, { progress: 0.5, opened: true })
		const home = homeSections(
			{
				...none,
				reading: Array.from({ length: 9 }, (_, i) => timed(`r${i}`, 5, { progress: 0.1 })),
				long: [started, timed("l-new", 40)],
			},
			{ minutes: 60 },
		)
		expect([home.hero, ...home.reading].map((a) => a!.id)).not.toContain("l-started")
		expect(ids(home.recent)).toEqual(["l-new"])
	})

	it("keeps the article read last when nothing in progress fits, and says so", () => {
		const home = homeSections(
			{
				...none,
				reading: [
					timed("r0", 50, { progress: 0.1, status: "processing" }),
					timed("r1", 50, { progress: 0.1 }),
					timed("r2", 40, { progress: 0.2 }),
				],
				unread: [timed("u", 4)],
			},
			{ minutes: 5 },
		)
		expect(home.hero?.id).toBe("r1")
		expect(home.pickUp).toBe(true)
		expect(ids(home.reading)).toEqual([])
		expect(ids(home.recent)).toEqual(["u"])
		expect(home.nothingFits).toBe(false)
	})

	it("says when nothing fits, not counting the article read last", () => {
		const home = homeSections(
			{ ...none, reading: [timed("r", 50, { progress: 0.1 })], unread: [timed("u", 20)] },
			{ minutes: 5 },
		)
		expect(home.hero?.id).toBe("r")
		expect(home.nothingFits).toBe(true)
		expect(homeSections({ ...none, unread: [timed("u", 20)] }, { minutes: 5 })).toMatchObject({
			hero: null,
			nothingFits: true,
		})
	})
})

describe("everyHomeArticle", () => {
	it("keeps what any time would show, not only Home at any length", () => {
		const item = (id: string, minutes: number, savedAt: string) =>
			({ id, status: "ready", readingMinutes: minutes, progress: 0, savedAt }) as ArticleSummary
		const unread = Array.from({ length: 9 }, (_, i) =>
			item(`u${i}`, 3, `2026-10-1${i}T10:00:00.000Z`),
		)
		const long = [item("l-50", 50, "2026-09-01T10:00:00.000Z")]
		const all = ids(everyHomeArticle({ reading: [], unread, quick: [], long }))
		expect(ids(homeSections({ reading: [], unread, quick: [], long }).recent)).not.toContain("l-50")
		expect(all).toContain("l-50")
		expect(all).toHaveLength(10)
	})
})

describe("offersTimeChoice", () => {
	const left = (id: string, fields: Partial<ArticleSummary> = {}) =>
		({ id, status: "ready", readingMinutes: 10, finished: false, ...fields }) as ArticleSummary
	const many = (n: number, prefix: string) =>
		Array.from({ length: n }, (_, i) => left(`${prefix}${i}`))

	it("offers it with more unfinished articles than Home shows at once", () => {
		const nine = { reading: many(3, "r"), unread: many(6, "u"), quick: [], long: [] }
		expect(offersTimeChoice(nine)).toBe(false)
		expect(offersTimeChoice({ ...nine, long: [left("l")] })).toBe(true)
	})

	it("counts each article once, and only those with a reading time to go", () => {
		const lists = {
			reading: many(3, "r"),
			unread: many(6, "u"),
			// The same articles again, and some that can't be timed or read.
			quick: many(6, "u"),
			long: [
				left("none", { readingMinutes: null }),
				left("done", { finished: true }),
				left("failed", { status: "failed" }),
			],
		}
		expect(offersTimeChoice(lists)).toBe(false)
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
		reading: [inbox("h"), inbox("r")],
		unread: [inbox("a"), inbox("b")],
		quick: [inbox("q")],
		long: [inbox("l")],
	}

	it("shows a change where the article is", () => {
		const next = withChanges(home, new Map([["a", inbox("a", { starred: true })]]))
		expect(next.unread[0]?.starred).toBe(true)
		expect(ids(next.unread)).toEqual(["a", "b"])
	})

	it("drops what left the library", () => {
		const next = withChanges(
			home,
			new Map([
				["h", inbox("h", { location: "archive" })],
				["b", inbox("b", { trashedAt: "2026-09-27T10:00:00.000Z" })],
				["l", inbox("l", { location: "archive" })],
			]),
		)
		expect(ids(next.reading)).toEqual(["r"])
		expect(ids(next.unread)).toEqual(["a"])
		expect(ids(next.long)).toEqual([])
	})
})
