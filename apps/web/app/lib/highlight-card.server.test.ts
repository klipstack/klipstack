import { describe, expect, it } from "vitest"
import {
	creditLine,
	highlightCardFor,
	highlightCardSvg,
	TALL_CONTENT_BOTTOM,
	tallLayout,
	wideNote,
} from "./highlight-card.server"

const snapshot = {
	exact: "A single meeting can blow a whole afternoon.",
	note: "Protect the mornings.",
	article: {
		title: "Maker's Schedule, Manager's Schedule",
		url: "https://paulgraham.com/makersschedule.html",
		siteName: null,
	},
}

describe("highlightCardSvg", () => {
	it("draws the quote without the marker, and the note on yellow paper whatever its color", () => {
		// Snapshots as stored, with their highlight's color.
		const [blueShare, pinkShare] = [2, 3].map((color) => ({ ...snapshot, color }))
		const blue = highlightCardSvg(highlightCardFor(blueShare!))
		const pink = highlightCardSvg(highlightCardFor(pinkShare!))
		// The same picture: the color means something to its owner only.
		expect(blue).toBe(pink)
		expect(blue).toContain('fill="#FDF1BF"')
		for (const marker of ["#FFE657", "#9EDEFF", "#FFBCD7"]) expect(blue).not.toContain(marker)
	})

	it("keeps the tall picture above its brand, however long the quote, the title and the note", () => {
		const long = (words: number) => Array.from({ length: words }, (_, i) => `word${i}`).join(" ")
		const layout = tallLayout({
			exact: long(400),
			note: long(200),
			site: "example.com",
			title: long(40),
		})
		expect(layout.titleLines).toHaveLength(2)
		expect(layout.note!.lines.length).toBeGreaterThan(5)
		expect(layout.note!.lines.at(-1)!.text).toMatch(/…$/)
		expect(layout.bottom).toBeLessThanOrEqual(TALL_CONTENT_BOTTOM)
	})

	it("shows a note of two paragraphs whole on both pictures, its paragraphs apart", () => {
		const first =
			"In the old world, we were able to shape the product in the right way while developing, because we were slow and could reflect while seeing how it took shape."
		const second =
			"Now the product takes shape before we have time to realize it took the wrong one."
		const note = `${first}\n\n${second}`
		const card = {
			exact:
				"In the old world, vague requirements ran into human slowness. In the agent world, vague requirements run into machine speed. That’s why specification suddenly feels important again. It was always important. We just used implementation cost as a crude forcing function and called the result process.",
			note,
			site: "O'Reilly Media",
			title: "The Right Amount of Spec for Agentic Development",
		}
		const tall = tallLayout(card)
		for (const { lines } of [wideNote(note).note, tall.note!]) {
			const at = lines.findIndex((line) => line.text.startsWith("Now"))
			expect(
				lines
					.slice(0, at)
					.map((line) => line.text)
					.join(" "),
			).toBe(first)
			expect(
				lines
					.slice(at)
					.map((line) => line.text)
					.join(" "),
			).toBe(second)
			// A gap between the paragraphs, wider than between their lines.
			const step = lines[1]!.y - lines[0]!.y
			expect(lines[at]!.y - lines[at - 1]!.y).toBeGreaterThan(step)
		}
		expect(tall.bottom).toBeLessThanOrEqual(TALL_CONTENT_BOTTOM)
	})

	it("credits the author beside the site, unless the author only repeats it", () => {
		const article = {
			title: "T",
			url: "https://example.com/essays/x",
			siteName: "Example Magazine",
		}
		const card = (author: string | null) =>
			highlightCardFor({ exact: "Q", note: null, article: { ...article, author } })
		expect(card("Ada Writer")).toMatchObject({ author: "Ada Writer", site: "Example Magazine" })
		expect(card("example magazine")).toMatchObject({ author: null, site: "Example Magazine" })
		expect(card(null)).toMatchObject({ author: null, site: "Example Magazine" })
	})

	it("shortens the site before the author, and leaves it out when the author fills the line", () => {
		const card = {
			exact: "Q",
			note: "A note.",
			site: "The New York Times Magazine — Culture, Politics and Ideas Since 1896",
			author: "Markus Eisele and Ada Writer",
			title: "T",
		}
		for (const shape of ["wide", "tall"] as const) {
			const line = creditLine(card, shape)
			expect(line).toMatch(/^MARKUS EISELE AND ADA WRITER · THE .*…$/)
		}
		const long = "Markus Eisele and Alexandra Montgomery-Smithson with Friends and Colleagues"
		expect(creditLine({ ...card, author: long }, "wide")).toMatch(/^MARKUS EISELE [^·]*…$/)
		expect(creditLine({ ...card, author: "Ada Writer", site: "Example" }, "wide")).toBe(
			"ADA WRITER · EXAMPLE",
		)
		expect(creditLine({ ...card, author: null, site: "Example" }, "tall")).toBe("EXAMPLE")
	})
})
