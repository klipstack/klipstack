import { describe, expect, it } from "vitest"
import { plainQuote } from "./quotes"

describe("plainQuote", () => {
	it("keeps link and image text", () => {
		expect(
			plainQuote("heard of [SEMA](http://www.sei.cmu.edu/sema/)? It is ![a chart](x.png)"),
		).toBe("heard of SEMA? It is a chart")
	})

	it("drops emphasis and code markers", () => {
		expect(plainQuote("a quick **yes** or __no__, _wait!_ and *fine* with `git`")).toBe(
			"a quick yes or no, wait! and fine with git",
		)
	})

	it("leaves underscores and asterisks inside words", () => {
		expect(plainQuote("snake_case_name and 2*3*4")).toBe("snake_case_name and 2*3*4")
	})

	it("drops line markers and unescapes", () => {
		expect(plainQuote("**1\\. Do you use source control?**")).toBe("1. Do you use source control?")
		expect(plainQuote("> quoted\n- item\n## Heading")).toBe("quoted\nitem\nHeading")
		expect(plainQuote("the \\<marquee> tag and \\&copy;")).toBe("the <marquee> tag and &copy;")
	})

	it("leaves plain text alone", () => {
		expect(plainQuote("  It’s a fairly esoteric system.  ")).toBe("It’s a fairly esoteric system.")
	})
})
