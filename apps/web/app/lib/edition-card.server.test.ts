import { resources } from "@klipstack/i18n"
import { createInstance } from "i18next"
import sharp from "sharp"
import { beforeAll, describe, expect, it } from "vitest"
import {
	CARD_HEIGHT,
	CARD_WIDTH,
	cachedCard,
	canDraw,
	cardFor,
	cardVersion,
	drawable,
	type EditionCard,
	editionCardPng,
	loadFonts,
	SHELF_RIGHT,
	shelfBooks,
	stackCards,
	wrap,
} from "./edition-card.server"

const site = (i: number) =>
	["Stay SaaSy", "paulgraham.com", "registerspill.thorstenball.com"][i % 3]!
const items = Array.from({ length: 14 }, (_, i) => ({
	site: site(i),
	title: `Article number ${i + 1}, on makers, managers and time`,
	minutes: i % 4 === 3 ? null : 3 + i * 5,
}))
const card: EditionCard = {
	cover: "stack",
	date: "September 20, 2026",
	title: "What I read this week: makers, managers and time",
	authorName: "Ada Reader",
	items: items.slice(0, 10),
	total: 10,
	count: "10 articles",
	more: (count) => `+ ${count} more`,
}
const font = () => loadFonts().text

describe("the edition card's text", () => {
	it("leaves out what the font cannot draw, rather than drawing boxes", () => {
		expect(drawable(font(), "Qué leí 😀 en septiembre")).toBe("Qué leí en septiembre")
		expect(canDraw("¿Qué leí? Ñandú, “citas” – y más…")).toBe(true)
		expect(canDraw("What I read 📚")).toBe(true)
		expect(canDraw("我读了什么")).toBe(false)
		expect(canDraw("😀")).toBe(false)
	})

	it("wraps by width, and ends a cut line after a word, never after punctuation", () => {
		const lines = wrap(font(), "One two three, four five six seven eight nine ten", 40, 300, 2)
		expect(lines).toHaveLength(2)
		expect(lines[1]).toMatch(/[a-z]…$/)
		expect(wrap(font(), "Short", 40, 300, 2)).toEqual(["Short"])
		const cut = wrap(font(), "Alpha, beta, gamma, delta, epsilon, zeta", 40, 260, 1)[0]!
		expect(cut).toMatch(/[a-z]…$/)
	})

	it("cuts a word wider than a line, an address as a title", () => {
		const [line, ...rest] = wrap(font(), `https://example.com/${"x".repeat(80)} more`, 28, 420, 2)
		expect(rest).toEqual([])
		expect(line).toMatch(/^https:\/\/example\.com\/x+…$/)
	})
})

describe("the stack", () => {
	it("shows the first articles on cards, the first on top, and how many more", () => {
		const { cards, more } = stackCards(card)
		expect(cards.map((c) => c.site)).toEqual([site(0), site(1), site(2), site(3)])
		expect(more).toBe(6)
	})

	it("shows what there is, with no 'more' when all fit", () => {
		expect(stackCards({ ...card, items: card.items.slice(0, 1), total: 1 })).toMatchObject({
			cards: [{ site: site(0) }],
			more: 0,
		})
	})
})

describe("the shelf", () => {
	const shelf = { ...card, cover: "shelf" as const }

	it("has a book for each article, wider the longer the read, medium without one", () => {
		const books = shelfBooks({ ...shelf, items: card.items.slice(0, 4), total: 4 })
		expect(books).toHaveLength(4)
		const [short, mid, long, unknown] = books.map((book) => book.width)
		expect(short).toBeLessThan(mid!)
		expect(mid).toBeLessThan(long!)
		expect(unknown).toBeGreaterThan(short!)
		expect(unknown).toBeLessThan(long!)
	})

	it("keeps the books on the shelf however many and however long", () => {
		const long = items.map((item) => ({ ...item, minutes: 60 }))
		const books = shelfBooks({ ...shelf, items: long, total: 30 })
		expect(books.length).toBeGreaterThan(6)
		expect(books.length).toBeLessThan(items.length)
		const last = books.at(-1)!
		expect(last.x + last.width).toBeLessThanOrEqual(SHELF_RIGHT)
	})
})

const i18n = createInstance()
beforeAll(async () => {
	await i18n.init({ resources, fallbackLng: "en", interpolation: { escapeValue: false } })
})

describe("the edition card", () => {
	it("puts the date over the title, or makes it the title when there is none", () => {
		const snapshot = {
			v: 1 as const,
			title: "Good reads",
			intro: null,
			authorName: "Ada Reader",
			locale: "es",
			cover: "stack" as const,
			items: [],
		}
		const published = { publishedAt: new Date("2026-09-30T22:30:00Z"), timeZone: "Europe/Madrid" }
		const t = i18n.getFixedT("es", "editions")
		expect(cardFor(snapshot, published, t)).toMatchObject({
			date: "1 de octubre de 2026",
			title: "Good reads",
		})
		expect(cardFor({ ...snapshot, title: null }, published, t)).toMatchObject({
			date: null,
			title: "1 de octubre de 2026",
		})
	})

	it("carries the cover, and each article's site and reading time", () => {
		const t = i18n.getFixedT("en", "editions")
		const item = {
			url: "https://www.example.com/a",
			title: "A",
			author: null,
			siteName: null,
			description: null,
			leadImageUrl: null,
			readingMinutes: 7,
			readOn: null,
			note: null,
			highlights: [],
		}
		const snapshot = {
			v: 1 as const,
			title: "Good reads",
			intro: null,
			authorName: "Ada Reader",
			locale: "en",
			cover: "shelf" as const,
			items: [item, { ...item, siteName: "Craig Mod", readingMinutes: null }],
		}
		const published = { publishedAt: new Date("2026-09-30T12:00:00Z"), timeZone: "UTC" }
		expect(cardFor(snapshot, published, t)).toMatchObject({
			cover: "shelf",
			items: [
				{ site: "example.com", title: "A", minutes: 7 },
				{ site: "Craig Mod", title: "A", minutes: null },
			],
			total: 2,
			count: "2 articles",
		})
	})

	it("draws without a date over the title", async () => {
		const meta = await sharp(await editionCardPng({ ...card, date: null })).metadata()
		expect(meta.width).toBe(CARD_WIDTH)
	})

	it("is a 1200×630 PNG, either cover", async () => {
		for (const cover of ["stack", "shelf"] as const) {
			const meta = await sharp(await editionCardPng({ ...card, cover })).metadata()
			expect([meta.format, meta.width, meta.height]).toEqual(["png", CARD_WIDTH, CARD_HEIGHT])
		}
	})

	it("has a new address for each Update and each new design", () => {
		const at = new Date("2026-10-01T00:00:00Z")
		const first = cardVersion({ publishedAt: at, republishedAt: null })
		expect(cardVersion({ publishedAt: at, republishedAt: new Date(at.getTime() + 1) })).not.toBe(
			first,
		)
		// Platforms keep the picture of an address: the design's number makes pages published
		// before it show the new one.
		expect(first).not.toBe(at.getTime().toString(36))
		expect(first).toMatch(/^[0-9a-z]+$/)
	})

	it("is drawn once per edition and version", async () => {
		let made = 0
		const make = () => {
			made++
			return card
		}
		const first = await cachedCard("test:1", make)
		expect(await cachedCard("test:1", make)).toBe(first)
		await cachedCard("test:2", make)
		expect(made).toBe(2)
	})
})
