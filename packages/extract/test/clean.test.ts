import { describe, expect, it } from "vitest"
import { cleanArticleHtml } from "../src/clean"

const url = "https://example.com/post"
const prose = (n: number) =>
	Array.from(
		{ length: n },
		(_, i) =>
			`<p>Paragraph ${i} with enough words to look like real article prose for the tests here.</p>`,
	).join("")

describe("cleanArticleHtml layout handling", () => {
	it("unwraps a single-row layout table around the article", () => {
		const nav =
			'<p><a href="/a">Home</a><br><a href="/b">Recent Changes</a><br><a href="/c">Blog</a></p>'
		const html = `<table><tr><td width="100">${nav}</td><td>${prose(12)}</td><td>${nav}</td></tr></table>`
		const out = cleanArticleHtml(html, { url, title: null })
		expect(out).not.toContain("<table")
		expect(out).not.toContain("Recent Changes")
		expect(out).toContain("Paragraph 11")
	})

	it("keeps data tables", () => {
		const rows = Array.from(
			{ length: 6 },
			(_, i) =>
				`<tr><td>Row ${i}</td><td>Value ${i} is fairly long text to spread content around</td></tr>`,
		).join("")
		const html = `${prose(3)}<table>${rows}</table>${prose(3)}`
		const out = cleanArticleHtml(html, { url, title: null })
		expect(out).toContain("<table")
		expect(out).toContain("Row 5")
	})

	it("trims link-dominated menus at the edges but keeps prose links", () => {
		const menu = '<p><a href="/x">Home</a> · <a href="/y">About</a> · <a href="/z">Contact</a></p>'
		const footer = '<ul><li><a href="/t">Terms</a></li><li><a href="/p">Privacy</a></li></ul>'
		const html = `${menu}${menu}${prose(4)}<p>Read <a href="/more">the follow-up post</a> for the details, it is a long sentence with a link inside it.</p>${footer}`
		const out = cleanArticleHtml(html, { url, title: null })
		expect(out).not.toContain("About")
		expect(out).not.toContain("Privacy")
		expect(out).toContain("the follow-up post")
		expect(out).toContain("Paragraph 0")
	})
})
