import { describe, expect, it } from "vitest"
import { articleMeta } from "./article-meta"

describe("articleMeta", () => {
	it("names the author of a post on X, and only the site elsewhere", () => {
		const post = {
			site: "X.com",
			author: "Jane Doe",
			url: "https://x.com/jane/status/1",
			readingMinutes: 3,
		}
		expect(articleMeta(post)).toBe("X.com · Jane Doe · 3 min")
		expect(
			articleMeta({ ...post, site: "The Guardian", url: "https://www.theguardian.com/world/a" }),
		).toBe("The Guardian · 3 min")
	})
})
