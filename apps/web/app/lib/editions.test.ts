import { describe, expect, it } from "vitest"
import {
	dayIn,
	editionSlug as slugOf,
	formatEditionDate,
	isHttpUrl,
	markdownUrl,
	nudgeReason,
	publishProblems,
	quoteProblem,
	quoteUsage,
} from "./editions"

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ")

describe("quote cap", () => {
	it("allows no quotes, whatever the article", () => {
		expect(quoteProblem([], 0)).toBeNull()
		expect(quoteUsage([], 5000)).toEqual({ quotes: 0, words: 0, wordLimit: 150 })
	})

	it("sums the words of every quote", () => {
		expect(quoteUsage(["one two", " three "], null)).toEqual({
			quotes: 2,
			words: 3,
			wordLimit: 150,
		})
	})

	it("allows 150 words when the article's length is unknown", () => {
		expect(quoteProblem([words(100), words(50)], null)).toBeNull()
		expect(quoteProblem([words(100), words(51)], null)).toBe("too-long")
	})

	it("allows a tenth of a short article", () => {
		expect(quoteProblem([words(30)], 300)).toBeNull()
		expect(quoteProblem([words(31)], 300)).toBe("too-long")
		expect(quoteProblem(["one"], 9)).toBe("too-long")
	})

	it("allows 3 highlights, however short", () => {
		expect(quoteProblem(["a", "b", "c"], null)).toBeNull()
		expect(quoteProblem(["a", "b", "c", "d"], null)).toBe("too-many")
	})

	it("refuses one highlight longer than the whole limit", () => {
		expect(quoteProblem([words(151)], 10_000)).toBe("too-long")
	})

	it("refuses a highlight that fits alone but not with the others", () => {
		const included = [words(120)]
		expect(quoteProblem([words(40)], 10_000)).toBeNull()
		expect(quoteProblem([...included, words(30)], 10_000)).toBeNull()
		expect(quoteProblem([...included, words(40)], 10_000)).toBe("too-long")
	})

	it("reports the highlight count before the words", () => {
		expect(quoteProblem([words(60), words(60), words(60), "d"], null)).toBe("too-many")
	})
})

// 1 October in Madrid, 30 September in UTC.
const published = new Date("2026-09-30T22:30:00Z")
const editionSlug = (title: string) => slugOf(title, published, "UTC")

describe("editionSlug", () => {
	it("is the day of the first publish without a title, in the edition's time zone", () => {
		expect(slugOf(null, published, "Europe/Madrid")).toBe("2026-10-01")
		expect(slugOf(null, published, "UTC")).toBe("2026-09-30")
	})

	it("follows the title", () => {
		expect(editionSlug("Week 38, 2026")).toBe("week-38-2026")
		expect(editionSlug("Sep 14 – Sep 21, 2026")).toBe("sep-14-sep-21-2026")
	})

	it("drops accents", () => {
		expect(editionSlug("Lecturas de otoño: ¿qué leí?")).toBe("lecturas-de-otono-que-lei")
	})

	it("cuts a long title at a word", () => {
		const title = "The quick brown fox jumps over the lazy dog while everyone else reads the news"
		const slug = editionSlug(title)
		expect(slug).toBe("the-quick-brown-fox-jumps-over-the-lazy-dog-while-everyone")
		expect(slug.length).toBeLessThanOrEqual(60)
	})

	it("cuts one long word where it must", () => {
		expect(editionSlug("a".repeat(100))).toBe("a".repeat(60))
	})

	it("is never empty", () => {
		expect(editionSlug("¡¿?!")).toBe("untitled")
	})
})

describe("edition dates", () => {
	it("are the day in the edition's time zone", () => {
		expect(dayIn(published, "Europe/Madrid")).toBe("2026-10-01")
		expect(dayIn(published, "America/Argentina/Buenos_Aires")).toBe("2026-09-30")
	})

	it("read in the edition's language", () => {
		expect(formatEditionDate(published, "en", "Europe/Madrid")).toBe("October 1, 2026")
		expect(formatEditionDate(published, "es", "Europe/Madrid")).toBe("1 de octubre de 2026")
	})
})

describe("nudgeReason", () => {
	const nudge = (marked: number, daysSince: number | null, readSince = 0) =>
		nudgeReason({ marked, daysSince, readSince, draft: null })

	it("takes three marked articles as an edition by themselves, first or not", () => {
		expect(nudge(3, null)).toBe("marked")
		expect(nudge(3, 2)).toBe("marked")
		expect(nudge(2, null)).toBeNull()
		expect(nudge(2, 13)).toBeNull()
	})

	it("after two weeks, takes less: one mark, or five articles finished", () => {
		expect(nudge(1, 14)).toBe("stale")
		expect(nudge(0, 30, 5)).toBe("stale")
		expect(nudge(0, 30, 4)).toBeNull()
		// Time alone is no reason; before a first edition, only marks are.
		expect(nudge(0, 60)).toBeNull()
		expect(nudge(0, null, 50)).toBeNull()
	})

	it("with a draft, never asks for another: a week after it was started, asks to publish it", () => {
		const signals = { marked: 9, daysSince: 60, readSince: 50 }
		const draft = (days: number, items: number) =>
			nudgeReason({ ...signals, draft: { days, items } })
		expect(draft(6, 4)).toBeNull()
		expect(draft(7, 4)).toBe("draft")
		expect(draft(30, 1)).toBe("draft")
		// Nothing in it yet: nothing to publish.
		expect(draft(30, 0)).toBeNull()
	})
})

describe("isHttpUrl and markdownUrl", () => {
	it("allows http and https only", () => {
		expect(isHttpUrl("https://example.com/a")).toBe(true)
		expect(isHttpUrl("http://example.com")).toBe(true)
		for (const url of ["javascript:alert(1)", "ftp://example.com", "/read/x", "", null, undefined])
			expect(isHttpUrl(url)).toBe(false)
	})

	it("escapes parentheses, which would end a Markdown link", () => {
		expect(markdownUrl("https://en.wikipedia.org/wiki/Mercury_(planet)")).toBe(
			"https://en.wikipedia.org/wiki/Mercury_%28planet%29",
		)
	})
})

describe("publishProblems", () => {
	const item = { id: "a", url: "https://example.com", wordCount: 1000, highlights: [] }

	it("needs an item, and no title", () => {
		expect(publishProblems([item])).toEqual([])
		expect(publishProblems([])).toEqual([{ code: "no_items" }])
	})

	it("lists the items with a bad address or too much quoted", () => {
		const quoted = { exact: words(101), included: true }
		expect(
			publishProblems([
				item,
				{ ...item, id: "b", url: "javascript:alert(1)" },
				{ ...item, id: "c", highlights: [quoted, { exact: words(500), included: false }] },
			]),
		).toEqual([
			{ code: "url", itemId: "b" },
			{ code: "quotes", itemId: "c", problem: "too-long" },
		])
	})
})
