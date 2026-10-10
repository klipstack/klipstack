import { resources } from "@klipstack/i18n"
import { describe, expect, it } from "vitest"
import { editionQuotes, INITIAL_MARKS, type Marks, QUOTE_MAX, SENTENCES } from "./sample"

describe.each(["en", "es"] as const)("the landing page's sample edition (%s)", (locale) => {
	const { sentences } = resources[locale].common.home.demo
	const textOf = (id: keyof typeof sentences) => sentences[id]

	it("quotes the opening highlights in full", () => {
		const { quotes, used } = editionQuotes(INITIAL_MARKS, textOf)
		expect(quotes.map((q) => q.id)).toEqual(["s5", "s8"])
		expect(quotes.every((q) => q.fits)).toBe(true)
		expect(used).toBeLessThanOrEqual(QUOTE_MAX)
	})

	it("leaves out what passes the limit when the whole article is marked", () => {
		const all: Marks = Object.fromEntries(SENTENCES.map((id) => [id, true]))
		const { quotes, used } = editionQuotes(all, textOf)
		expect(quotes.map((q) => q.id)).toEqual(SENTENCES)
		expect(quotes.some((q) => !q.fits)).toBe(true)
		expect(used).toBeLessThanOrEqual(QUOTE_MAX)
	})
})
