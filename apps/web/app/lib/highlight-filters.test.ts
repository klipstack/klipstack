import { describe, expect, it } from "vitest"
import { highlightsHref, highlightsKeep, searchTerms } from "./highlight-filters"

const texts = (q: string) => searchTerms(q).map((t) => t.text)

describe("searchTerms", () => {
	it("splits words", () => {
		expect(searchTerms("  code   review ")).toEqual([
			{ text: "code", phrase: false },
			{ text: "review", phrase: false },
		])
	})
	it("keeps quoted phrases whole, straight or curly", () => {
		expect(searchTerms('time "code review" x')).toEqual([
			{ text: "time", phrase: false },
			{ text: "code review", phrase: true },
			{ text: "x", phrase: false },
		])
		expect(texts("“half a  day” work")).toEqual(["half a day", "work"])
	})
	it("treats an unclosed quote as plain words", () => {
		expect(searchTerms('"code review')).toEqual([
			{ text: "code", phrase: false },
			{ text: "review", phrase: false },
		])
	})
	it("ignores empty quotes and caps at 8 terms", () => {
		expect(texts('"" a')).toEqual(["a"])
		expect(searchTerms("1 2 3 4 5 6 7 8 9")).toHaveLength(8)
	})
})

describe("highlightsHref", () => {
	const state = { q: "", filter: null, view: "stream", tag: null, topic: null } as const
	it("names the view always, and the rest when set", () => {
		expect(highlightsHref(state)).toBe("/highlights?view=stream")
		expect(
			highlightsHref(
				{ ...state, q: "a b", filter: "notes", tag: "t1", topic: "p1" },
				{ view: "articles" },
			),
		).toBe("/highlights?q=a+b&show=notes&tag=t1&topic=p1&view=articles")
	})
	it("drops the topic for the topics view, which shows them all", () => {
		expect(highlightsHref({ ...state, topic: "p1" }, { view: "topics" })).toBe(
			"/highlights?view=topics",
		)
		expect(highlightsKeep({ ...state, view: "topics", topic: "p1", tag: "t" })).toEqual({
			view: "topics",
			tag: "t",
		})
	})
	it("deals a hand instead of a view, and pages the stream", () => {
		expect(highlightsHref({ ...state, filter: "blue" }, { shuffle: "new" })).toBe(
			"/highlights?show=blue&shuffle=new",
		)
		expect(highlightsHref(state, { cursor: "abc" })).toBe("/highlights?view=stream&cursor=abc")
	})
})
