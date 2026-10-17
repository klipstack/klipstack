import { describe, expect, it } from "vitest"
import {
	endsPage,
	reloaded,
	leftText,
	putBack,
	reviewNotice,
	savedAgo,
	spanText,
	swipeDecision,
	toDecide,
} from "./review"

const a = (id: string) => ({ id })
const ids = (items: { id: string }[]) => items.map((x) => x.id)

describe("toDecide and putBack", () => {
	it("leaves out what was decided, in the review's order", () => {
		expect(ids(toDecide([a("1"), a("2"), a("3")], new Set(["2"])))).toEqual(["1", "3"])
	})

	it("puts an undone article back first when a reload left it out, as it was otherwise", () => {
		// Reloaded since: the server lists only what is left.
		expect(ids(putBack([a("3"), a("4")], [a("1"), a("2")]))).toEqual(["1", "2", "3", "4"])
		// Still in the page: where it was, not twice.
		expect(ids(putBack([a("1"), a("2"), a("3")], [a("2")]))).toEqual(["1", "2", "3"])
	})
})

describe("reloaded", () => {
	it("keeps what was decided and undone while the reload was on its way", () => {
		// The answer was computed before "1" was archived and before "9" was undone.
		const answer = [a("1"), a("2"), a("3")]
		const out = reloaded(answer, { decided: new Set(["1"]), undone: [a("9")] })
		expect(ids(toDecide(out.items, out.decided))).toEqual(["9", "2", "3"])
	})

	it("leaves out an article undone, then decided again", () => {
		const out = reloaded([a("2")], { decided: new Set(["9"]), undone: [a("9")] })
		expect(ids(toDecide(out.items, out.decided))).toEqual(["2"])
	})
})

describe("endsPage", () => {
	it("is the last of the page only when nothing is left of it and more wait", () => {
		const left = [a("1"), a("2")]
		expect(endsPage(left, ["1"], true)).toBe(false)
		expect(endsPage(left, ["1", "2"], true)).toBe(true)
		expect(endsPage([a("2")], ["2"], true)).toBe(true)
		// Nothing waits after the page: the review is done instead.
		expect(endsPage([a("2")], ["2"], false)).toBe(false)
	})
})

describe("swipeDecision", () => {
	const width = 300
	it("keeps to the right and archives to the left, a third of the width away", () => {
		expect(swipeDecision(100, 0, width)).toBe("keep")
		expect(swipeDecision(-100, 0, width)).toBe("archive")
		expect(swipeDecision(99, 0, width)).toBeNull()
		expect(swipeDecision(-99, 0, width)).toBeNull()
	})

	it("decides on a fling, only in the direction it moved", () => {
		expect(swipeDecision(50, 1.2, width)).toBe("keep")
		expect(swipeDecision(-50, -1.2, width)).toBe("archive")
		// Flung back toward the middle, or barely moved: no decision.
		expect(swipeDecision(50, -1.2, width)).toBeNull()
		expect(swipeDecision(20, 2, width)).toBeNull()
	})
})

describe("words", () => {
	it("says what was done, one or many", () => {
		expect(reviewNotice("keep", 1)).toBe("Kept")
		expect(reviewNotice("archive", 1)).toBe("Archived")
		expect(reviewNotice("delete", 1)).toBe("Deleted")
		expect(reviewNotice("keep", 12)).toBe("12 articles kept")
		expect(reviewNotice("archive", 2)).toBe("2 articles archived")
	})

	it("says how long ago it was saved", () => {
		const now = new Date("2026-10-16T12:00:00Z")
		const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString()
		expect(savedAgo(ago(1), now)).toBe("Saved 1 day ago")
		expect(savedAgo(ago(13), now)).toBe("Saved 13 days ago")
		expect(savedAgo(ago(35), now)).toBe("Saved 5 weeks ago")
		expect(savedAgo(ago(59), now)).toBe("Saved 8 weeks ago")
		expect(savedAgo(ago(60), now)).toBe("Saved 2 months ago")
		expect(savedAgo(ago(364), now)).toBe("Saved 12 months ago")
		expect(savedAgo(ago(400), now)).toBe("Saved a year ago")
		expect(savedAgo(ago(800), now)).toBe("Saved 2 years ago")
	})

	it("says the server's spans and what is left", () => {
		expect(spanText(30)).toBe("a month")
		expect(spanText(90)).toBe("3 months")
		expect(spanText(45)).toBe("45 days")
		expect(leftText(12, false)).toBe("12 left")
		expect(leftText(25, true)).toBe("25+ left")
	})
})
