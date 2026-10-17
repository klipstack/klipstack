import { describe, expect, it } from "vitest"
import {
	highlightCardFor,
	highlightCardSvg,
	TALL_CONTENT_BOTTOM,
	tallLayout,
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
		expect(layout.noteLines.length).toBeGreaterThan(5)
		expect(layout.bottom).toBeLessThanOrEqual(TALL_CONTENT_BOTTOM)
	})
})
