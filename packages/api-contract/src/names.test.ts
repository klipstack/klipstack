import { describe, expect, it } from "vitest"
import { articleFileBase, cleanTagName, insertTitle, slugify } from "./names"

describe("slugify", () => {
	it("strips accents and caps the length", () => {
		expect(slugify("Ünïcödé — naïve café")).toBe("unicode-naive-cafe")
		expect(slugify("a".repeat(100))).toHaveLength(80)
	})
})

describe("articleFileBase", () => {
	it("prefixes the slug with the saved date, falling back to the URL", () => {
		expect(articleFileBase("2026-09-01T10:00:00.000Z", "An article", "https://x.test")).toBe(
			"2026-09-01-an-article",
		)
		expect(articleFileBase("2026-09-01T10:00:00.000Z", null, "https://example.com/a")).toBe(
			"2026-09-01-https-example-com-a",
		)
	})
})

describe("insertTitle", () => {
	it("makes a title safe as note link text", () => {
		expect(insertTitle("A [bracketed] title")).toBe("A bracketed title")
		expect(insertTitle("  spaced \n out  ")).toBe("spaced out")
		expect(insertTitle("Parens (kept)")).toBe("Parens (kept)")
		expect(insertTitle("x".repeat(250))).toHaveLength(200)
	})
})

describe("cleanTagName", () => {
	it("trims and collapses whitespace", () => {
		expect(cleanTagName("  machine \t learning ")).toBe("machine learning")
	})

	it("refuses what a name cannot hold", () => {
		expect(cleanTagName("   ")).toBeNull()
		expect(cleanTagName("a".repeat(51))).toBeNull()
		expect(cleanTagName('say "hi"')).toBeNull()
		expect(cleanTagName("a,b")).toBeNull()
		expect(cleanTagName(`a${String.fromCharCode(0)}b`)).toBeNull()
		expect(cleanTagName("a".repeat(50))).toBe("a".repeat(50))
	})
})
