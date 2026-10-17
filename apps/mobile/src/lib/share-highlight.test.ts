import { describe, expect, it } from "vitest"
import { linkStale, parseShareTab, shareLocale, shownTab } from "./share-highlight"

const live = {
	removed: false,
	publicId: "abc",
	url: "u",
	includeNote: true,
	changed: false,
} as const

describe("the Share sheet", () => {
	it("opens on Link for a highlight with a live link, until another tab is chosen", () => {
		expect(shownTab(live, "image", false)).toBe("link")
		expect(shownTab(live, "image", true)).toBe("image")
		expect(shownTab({ removed: true }, "image", false)).toBe("image")
		expect(shownTab(null, "text", false)).toBe("text")
		// Still looking: the tab chosen last.
		expect(shownTab(undefined, "image", false)).toBe("image")
	})

	it("remembers Link and Image, and starts on Text otherwise", () => {
		expect(parseShareTab('"image"')).toBe("image")
		expect(parseShareTab('"link"')).toBe("link")
		expect(parseShareTab(null)).toBe("text")
		expect(parseShareTab('"square"')).toBe("text")
		expect(parseShareTab("{oops")).toBe("text")
	})

	it("offers an update when the highlight changed, or the note choice differs from the page's", () => {
		expect(linkStale(live, true)).toBe(false)
		expect(linkStale(live, false)).toBe(true)
		expect(linkStale({ ...live, changed: true }, true)).toBe(true)
		expect(linkStale({ removed: true }, false)).toBe(false)
		expect(linkStale(null, true)).toBe(false)
	})

	it("writes the page in Spanish for a phone in Spanish, else in English", () => {
		expect(shareLocale("es-MX")).toBe("es")
		expect(shareLocale("en-US")).toBe("en")
		expect(shareLocale("fr-FR")).toBe("en")
	})
})
