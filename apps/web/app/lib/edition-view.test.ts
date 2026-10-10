import { resources } from "@klipstack/i18n"
import { createInstance } from "i18next"
import { beforeAll, describe, expect, it } from "vitest"
import type { EditionSnapshot } from "~/services/editions.server"
import { editionDescription, editionView } from "./edition-view"

const i18n = createInstance()
beforeAll(async () => {
	await i18n.init({ resources, fallbackLng: "en", interpolation: { escapeValue: false } })
})

const item: EditionSnapshot["items"][number] = {
	url: "https://en.wikipedia.org/wiki/Mercury_(planet)",
	title: "Mercury",
	author: "Grace",
	siteName: "Wikipedia",
	description: "A planet.",
	leadImageUrl: null,
	readingMinutes: 8,
	readOn: "2026-09-16",
	note: null,
	highlights: [],
}

const snapshot: EditionSnapshot = {
	v: 1,
	title: "Good reads",
	intro: null,
	authorName: "Ada Reader",
	locale: "en",
	items: [
		item,
		{ ...item, url: "https://b.example/", title: "B", leadImageUrl: "https://img.example/b.jpg" },
	],
}

/** First published on 20 September, in Madrid. */
const firstPublished = new Date("2026-09-20T10:00:00Z")

describe("editionView", () => {
	it("writes every string in the edition's language", () => {
		const published = {
			publishedAt: firstPublished,
			republishedAt: new Date("2026-09-21T23:30:00Z"),
			timeZone: "Europe/Madrid",
		}
		const en = editionView(snapshot, published, i18n.getFixedT("en", "editions"))
		expect(en).toMatchObject({ title: "Good reads", date: "September 20, 2026" })
		expect(en.updated).toBe("Updated Sep 22, 2026")
		expect(en.items[0]!.kicker).toBe("Wikipedia")
		// The day it was read stays in the snapshot, off the page.
		expect(en.items[0]!.meta).toEqual(["Grace", "8 min read"])
		const es = editionView(
			{ ...snapshot, locale: "es" },
			published,
			i18n.getFixedT("es", "editions"),
		)
		expect(es.locale).toBe("es")
		expect(es.date).toBe("20 de septiembre de 2026")
		expect(es.updated).toBe("Actualizado el 22 sept 2026")
		expect(es.items[0]!.meta).toContain("8 min de lectura")
	})

	it("says it was updated only on a later day than it came out", () => {
		const view = (republishedAt: Date) =>
			editionView(
				snapshot,
				{ publishedAt: firstPublished, republishedAt, timeZone: "Europe/Madrid" },
				i18n.getFixedT("en", "editions"),
			)
		// 23:30 on the 20th in Madrid.
		expect(view(new Date("2026-09-20T21:30:00Z")).updated).toBeNull()
		// 00:30 on the 21st in Madrid.
		expect(view(new Date("2026-09-20T22:30:00Z")).updated).toBe("Updated Sep 21, 2026")
	})

	it("makes the date the title when there is none, and does not repeat it", () => {
		const view = editionView(
			{ ...snapshot, title: null },
			{ publishedAt: firstPublished, republishedAt: null, timeZone: "Europe/Madrid" },
			i18n.getFixedT("en", "editions"),
		)
		expect(view).toMatchObject({ title: "September 20, 2026", date: null })
	})

	it("leaves out what an item does not have, and repeats", () => {
		const bare = { ...item, author: "Wikipedia", readingMinutes: null, readOn: null }
		const view = editionView(
			{ ...snapshot, items: [bare, { ...bare, siteName: null, url: "https://www.b.example/x" }] },
			{ publishedAt: firstPublished, republishedAt: null, timeZone: "UTC" },
			i18n.getFixedT("en", "editions"),
		)
		expect(view.updated).toBeNull()
		expect(view.items[0]!.kicker).toBe("Wikipedia")
		expect(view.items[0]!.meta).toEqual([])
		// No site name: the host names it.
		expect(view.items[1]!.kicker).toBe("b.example")
		expect(view.items[1]!.meta).toEqual(["Wikipedia"])
	})

	it("draws the first item large, and the others by what they hold", () => {
		const quote = (words: number) => ({ exact: "word ".repeat(words).trim(), note: null })
		const view = editionView(
			{
				...snapshot,
				items: [
					item,
					{ ...item, note: "Mine." },
					{ ...item, highlights: [quote(40)] },
					{ ...item, highlights: [quote(41), quote(3)] },
					{ ...item, note: "Mine.", highlights: [quote(3)] },
					{ ...item, leadImageUrl: "https://img.example/c.jpg" },
				],
			},
			{ publishedAt: firstPublished, republishedAt: null, timeZone: "UTC" },
			i18n.getFixedT("en", "editions"),
		)
		expect(view.items.map((i) => i.layout)).toEqual([
			"lead",
			"feature",
			"feature",
			"feature",
			"feature",
			"brief",
		])
		// Only a first quote short enough stands out, and only when no note comes before it.
		expect(view.items.map((i) => i.pullQuote)).toEqual([false, false, true, false, false, false])
	})

	it("anchors each item by its address, as note links write it", () => {
		const view = editionView(
			snapshot,
			{ publishedAt: firstPublished, republishedAt: null, timeZone: "UTC" },
			i18n.getFixedT("en", "editions"),
		)
		expect(view.anchors).toEqual({
			"https://en.wikipedia.org/wiki/Mercury_(planet)": "item-1",
			"https://en.wikipedia.org/wiki/Mercury_%28planet%29": "item-1",
			"https://b.example/": "item-2",
		})
	})
})

describe("link previews", () => {
	const t = () => i18n.getFixedT("en", "editions")

	it("describe the edition by its intro, else by its size", () => {
		expect(editionDescription(snapshot, t())).toBe("2 articles")
		expect(editionDescription({ ...snapshot, items: [item] }, t())).toBe("1 article")
		expect(
			editionDescription({ ...snapshot, intro: "What [I](https://a.example) read." }, t()),
		).toBe("What I read.")
		const long = editionDescription({ ...snapshot, intro: "word ".repeat(100) }, t())
		expect(long.length).toBeLessThanOrEqual(200)
		expect(long).toMatch(/word…$/)
	})
})
