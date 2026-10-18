import { describe, expect, it } from "vitest"
import { creditAuthor, sourceLabel } from "./site-label"

describe("sourceLabel", () => {
	it("names the author of a post on X", () => {
		expect(
			sourceLabel({
				siteName: "X.com",
				author: "Jane Doe",
				sourceUrl: "https://x.com/jane/status/1",
			}),
		).toBe("X.com · Jane Doe")
	})

	it("names only the site elsewhere", () => {
		expect(
			sourceLabel({
				siteName: "The Guardian",
				author: "Jane Doe",
				sourceUrl: "https://www.theguardian.com/world/a",
			}),
		).toBe("The Guardian")
	})

	it("falls back to the host", () => {
		expect(
			sourceLabel({ siteName: null, author: null, sourceUrl: "https://x.com/i/status/1" }),
		).toBe("x.com")
	})
})

describe("creditAuthor", () => {
	it("leaves out an author who repeats the site's name, however long the name is", () => {
		const tagline = "O'Reilly Media — Technology and Business Training"
		const article = { title: "T", url: "https://www.oreilly.com/radar/a", siteName: tagline }
		expect(creditAuthor({ ...article, author: tagline })).toBe(null)
		expect(creditAuthor({ ...article, author: "oreilly.com" })).toBe(null)
		expect(creditAuthor({ ...article, author: "Ada Writer" })).toBe("Ada Writer")
	})
})
