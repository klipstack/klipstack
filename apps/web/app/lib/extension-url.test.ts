import { describe, expect, it } from "vitest"
import { extensionUrl } from "./extension-url"

describe("extensionUrl", () => {
	it("sends klipstack.com's readers to the Chrome Web Store", () => {
		expect(extensionUrl("https://klipstack.com")).toBe(
			"https://chromewebstore.google.com/detail/jpaablflkefkjccjgmaibjljcikbemoa",
		)
	})

	it("sends another server's readers to the source: the store's extension saves to klipstack.com only", () => {
		for (const appUrl of [
			"https://reader.example.com",
			"http://localhost:5180",
			"https://klipstack.com.example.org",
		])
			expect(extensionUrl(appUrl)).toBe(
				"https://github.com/klipstack/klipstack/tree/main/apps/extension",
			)
	})
})
