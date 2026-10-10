import { describe, expect, it, vi } from "vitest"
import type { Extractor } from "../src/extractors/types"
import { extractArticle } from "../src/pipeline"

const prose = Array.from(
	{ length: 12 },
	(_, i) =>
		`<p>Paragraph ${i} with enough words to look like real article prose for the tests.</p>`,
).join("")

describe("extractArticle", () => {
	it("logs a failed extractor by host, name and frames, and uses the next one", async () => {
		const broken: Extractor = {
			name: "broken",
			version: "1",
			async extract() {
				throw new TypeError("cannot read secret page text")
			},
		}
		const plain: Extractor = {
			name: "plain",
			version: "1",
			async extract(doc) {
				return { contentHtml: doc.body.innerHTML }
			},
		}
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
		const article = await extractArticle({
			html: `<!doctype html><title>Post</title><body>${prose}</body>`,
			url: "https://example.com/secret/path?token=secret",
			extractors: [broken, plain],
		})
		const lines = spy.mock.calls.map((args) => args.join(" "))
		spy.mockRestore()
		expect(article.extractor.name).toBe("plain")
		expect(lines).toHaveLength(1)
		expect(lines[0]).toMatch(/^\[extract\] broken failed on example\.com: TypeError\n {4}at /)
		expect(lines[0]).not.toContain("secret")
	})
})
