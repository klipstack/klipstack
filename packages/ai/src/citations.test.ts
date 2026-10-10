import { describe, expect, it } from "vitest"
import { anthropicCitation, citationRange } from "./citations"

const text = "One sentence here. Another sentence follows.\n\nOne sentence here."

describe("citationRange", () => {
	it("keeps the offsets when they hold the quoted text, without the whitespace at the ends", () => {
		const start = text.indexOf("Another")
		const cited = { start: start - 1, end: text.indexOf("\n\n") + 2, citedText: "" }
		cited.citedText = text.slice(cited.start, cited.end)
		expect(citationRange(text, cited, 7)).toEqual({
			start,
			end: text.indexOf("\n\n"),
			exact: "Another sentence follows.",
			at: 7,
		})
	})

	it("finds the quote nearest the offsets when they do not hold it", () => {
		const second = text.lastIndexOf("One sentence here.")
		expect(
			citationRange(
				text,
				{ start: second + 3, end: second + 9, citedText: "One sentence here." },
				0,
			),
		).toMatchObject({ start: second, exact: "One sentence here." })
		expect(citationRange(text, { citedText: "One sentence here." }, 0)).toMatchObject({ start: 0 })
	})

	it("drops a quote the text does not have, or an empty one", () => {
		expect(citationRange(text, { start: 0, end: 5, citedText: "Not in it." }, 0)).toBeNull()
		expect(citationRange(text, { start: 0, end: 1, citedText: " " }, 0)).toBeNull()
	})
})

describe("anthropicCitation", () => {
	it("reads the provider's metadata", () => {
		expect(
			anthropicCitation({ anthropic: { citedText: "x", startCharIndex: 1, endCharIndex: 2 } }),
		).toEqual({ citedText: "x", start: 1, end: 2 })
		expect(anthropicCitation({ anthropic: { citedText: "x", startPageNumber: 1 } })).toEqual({
			citedText: "x",
			start: undefined,
			end: undefined,
		})
		expect(anthropicCitation(undefined)).toBeNull()
	})
})
