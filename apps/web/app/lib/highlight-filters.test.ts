import { describe, expect, it } from "vitest"
import { searchTerms } from "./highlight-filters"

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
