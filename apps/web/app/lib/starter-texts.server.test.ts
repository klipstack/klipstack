import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"
import {
	STARTER_LANGUAGES,
	STARTER_TOPICS,
	starterGuide,
	starterTexts,
	starterTextsIn,
} from "./starter-texts.server"

describe("the catalog", () => {
	it.each(STARTER_LANGUAGES)("has a guide and a full shelf of each topic in %s", (language) => {
		expect(starterGuide(language).kind).toBe("guide")
		const texts = starterTextsIn(language)
		expect(texts.every((text) => text.language === language && text.kind === "text")).toBe(true)
		for (const topic of STARTER_TOPICS) {
			expect(texts.filter((text) => text.topic === topic).length, topic).toBeGreaterThanOrEqual(3)
		}
	})

	it("names each text once, at an address of its own", () => {
		const texts = starterTexts()
		expect(new Set(texts.map((text) => text.slug)).size).toBe(texts.length)
		expect(new Set(texts.map((text) => text.url)).size).toBe(texts.length)
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
