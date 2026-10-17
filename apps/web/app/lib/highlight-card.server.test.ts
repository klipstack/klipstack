import { describe, expect, it } from "vitest"
import { highlightCardFor, highlightCardSvg } from "./highlight-card.server"

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
})
