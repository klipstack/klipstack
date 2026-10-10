import { describe, expect, it } from "vitest"
import { sourceLabel } from "./site-label"

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
