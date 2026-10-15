import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"
import { starterTexts, starterTextsFor } from "./starter-texts.server"

describe("starterTextsFor", () => {
	it("puts the reader's language first, guide first, and keeps the rest", () => {
		const es = starterTextsFor("es")
		expect(es.map((text) => text.language)).toEqual([
			...Array.from({ length: 5 }, () => "es"),
			...Array.from({ length: 7 }, () => "en"),
		])
		expect(es[0]!.slug).toBe("guide-es")
		expect(es[5]!.slug).toBe("guide-en")
		expect(starterTextsFor("en")[0]!.slug).toBe("guide-en")
	})
})

// The guide's public page shows its markup as it is, without the sanitizing extraction gives a
// saved copy: every page keeps to plain text markup, so a later edit can't slip in more.
const ALLOWED = new Set([
	"H1",
	"H2",
	"H3",
	"P",
	"EM",
	"STRONG",
	"I",
	"B",
	"BLOCKQUOTE",
	"BR",
	"UL",
	"OL",
	"LI",
	"HR",
])

describe("the bundled pages", () => {
	it.each(starterTexts().map((text) => [text.slug, text.article]))(
		"%s holds only text markup, without attributes but a list's start",
		(_slug, article) => {
			const elements = [...new JSDOM(article).window.document.body.querySelectorAll("*")]
			expect(elements.length).toBeGreaterThan(0)
			for (const element of elements) {
				expect(ALLOWED.has(element.tagName), element.tagName).toBe(true)
				const names = [...element.attributes].map((attribute) => attribute.name)
				expect(names, element.outerHTML.slice(0, 80)).toEqual(
					element.tagName === "OL" ? names.filter((name) => name === "start") : [],
				)
			}
		},
	)
})
