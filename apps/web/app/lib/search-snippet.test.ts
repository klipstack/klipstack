import { describe, expect, it } from "vitest"
import { foldWord, matchedIn, snippet, snippetText, startsWithAny } from "./search-snippet"

describe("snippet", () => {
	it("marks the matched words, accents and case aside", () => {
		expect(snippet("La Decisión fue difícil", matchedIn(["decision"]))).toEqual([
			{ text: "La " },
			{ text: "Decisión", match: true },
			{ text: " fue difícil" },
		])
	})

	it("cuts a long text around the first match, at word boundaries", () => {
		const text = `${"word ".repeat(100)}needle and then ${"more ".repeat(100)}`
		const runs = snippet(text, matchedIn(["needle"]), 60)
		const shown = snippetText(runs)
		expect(shown.startsWith("…word ")).toBe(true)
		expect(shown.endsWith(" more…")).toBe(true)
		expect(runs).toContainEqual({ text: "needle", match: true })
		expect(shown.length).toBeLessThanOrEqual(62)
	})

	it("shows the start of a long text without a match", () => {
		const runs = snippet(`Start here. ${"filler ".repeat(50)}`, () => false, 20)
		expect(runs).toEqual([{ text: "Start here. filler…" }])
	})

	it("reads Markdown links as their text, and line breaks as spaces", () => {
		expect(snippetText(snippet("See [the essay](/read/abc)\n\nfor more", () => false))).toBe(
			"See the essay for more",
		)
	})

	it("marks the parts of a hyphenated match", () => {
		expect(snippet("long-form essays", matchedIn(["long-form"]))).toEqual([
			{ text: "long", match: true },
			{ text: "-" },
			{ text: "form", match: true },
			{ text: " essays" },
		])
	})
})

describe("startsWithAny", () => {
	it("accepts words that start with a typed word", () => {
		const isMatch = startsWithAny(["sched", "Ñan"])
		expect(isMatch(foldWord("Scheduling"))).toBe(true)
		expect(isMatch(foldWord("ñandú"))).toBe(true)
		expect(isMatch(foldWord("rescheduled"))).toBe(false)
	})
})
