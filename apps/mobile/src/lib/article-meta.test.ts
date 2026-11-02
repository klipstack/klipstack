import { describe, expect, it } from "vitest"
import { articleByline, articleMeta } from "./article-meta"

describe("articleMeta", () => {
	it("names the author of a post on X, and only the site elsewhere, apart from the time", () => {
		const post = {
			site: "X.com",
			author: "Jane Doe",
			url: "https://x.com/jane/status/1",
			readingMinutes: 3,
		}
		expect(articleMeta(post)).toEqual({ source: "X.com · Jane Doe", time: "3 min" })
		expect(
			articleMeta({ ...post, site: "The Guardian", url: "https://www.theguardian.com/world/a" }),
		).toEqual({ source: "The Guardian", time: "3 min" })
	})

	it("leaves the time out when the length is unknown", () => {
		expect(
			articleMeta({ site: null, author: null, url: "https://danluu.com/a", readingMinutes: null }),
		).toEqual({ source: "danluu.com", time: null })
	})
})

describe("articleByline", () => {
	it("keeps the minutes left apart from the author, once reading started", () => {
		const item = { author: "Jane Doe", readingMinutes: 10, progress: 0, status: "ready" as const }
		expect(articleByline(item)).toEqual({ source: "Jane Doe", time: "10 min" })
		expect(articleByline({ ...item, progress: 0.5 })).toEqual({
			source: "Jane Doe",
			time: "5 min left",
		})
	})
})
