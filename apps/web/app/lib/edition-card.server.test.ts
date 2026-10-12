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
	contents,
	drawable,
	type EditionCard,
	editionCardPng,
	editionCardSvg,
	loadFonts,
	wrap,
} from "./edition-card.server"

const card: EditionCard = {
	date: "September 20, 2026",
	title: "What I read this week: makers, managers and time",
	authorName: "Ada Reader",
	items: [
		{ site: "Stay SaaSy", title: "Managing High Performers" },
		{ site: "paulgraham.com", title: "Maker's Schedule, Manager's Schedule" },
		{ site: "registerspill.thorstenball.com", title: "Be findable" },
	],
	total: 10,
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

describe("the edition card's contents", () => {
	const long = "A title long enough that it needs two lines in the column at this size"

	it("gives titles two lines while they fit, then one", () => {
		const shown = contents(font(), {
			...card,
			items: card.items.map((item) => ({ ...item, title: long })),
		})
		expect(shown).toHaveLength(3)
		expect(shown.map((item) => item.lines.length)).toEqual([2, 1, 1])
	})

	it("shows what there is, with no 'more' when all fit", () => {
		const two = { ...card, items: card.items.slice(0, 2), total: 2 }
		expect(contents(font(), two).map((item) => item.site)).toEqual(["Stay SaaSy", "paulgraham.com"])
		expect(editionCardSvg(two)).not.toContain("more")
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

	it("draws without a date over the title", async () => {
		const meta = await sharp(await editionCardPng({ ...card, date: null })).metadata()
		expect(meta.width).toBe(CARD_WIDTH)
	})

	it("is a 1200×630 PNG", async () => {
		const meta = await sharp(await editionCardPng(card)).metadata()
		expect([meta.format, meta.width, meta.height]).toEqual(["png", CARD_WIDTH, CARD_HEIGHT])
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
