import { describe, expect, it } from "vitest"
import { linkIn } from "./save-link"

describe("linkIn", () => {
	it("takes a link as it is", () => {
		expect(linkIn("  https://example.com/a?b=1#c \n")).toBe("https://example.com/a?b=1#c")
		expect(linkIn("http://example.com")).toBe("http://example.com")
	})

	it("finds the first link in text", () => {
		expect(linkIn("Read this: https://example.com/post. And https://other.com")).toBe(
			"https://example.com/post",
		)
		expect(linkIn("“https://example.com/q?x=1”, she said")).toBe("https://example.com/q?x=1")
		expect(linkIn("(see https://example.com/a)")).toBe("https://example.com/a")
	})

	it("keeps brackets the link opens", () => {
		expect(linkIn("https://en.wikipedia.org/wiki/Foo_(bar)")).toBe(
			"https://en.wikipedia.org/wiki/Foo_(bar)",
		)
		expect(linkIn("(https://en.wikipedia.org/wiki/Foo_(bar))")).toBe(
			"https://en.wikipedia.org/wiki/Foo_(bar)",
		)
	})

	it("adds https to an address without its scheme", () => {
		expect(linkIn("example.com/page")).toBe("https://example.com/page")
		expect(linkIn(" www.example.co.uk ")).toBe("https://www.example.co.uk")
	})

	it("finds nothing in other text", () => {
		expect(linkIn("")).toBeNull()
		expect(linkIn("just some words")).toBeNull()
		expect(linkIn("e.g. this")).toBeNull()
		expect(linkIn("ftp://example.com/file")).toBeNull()
		expect(linkIn("see example.com today")).toBeNull()
	})
})
