import { describe, expect, it } from "vitest"
import { highlightShareText } from "./highlight-share"

const A = "0193a5f1-2c3d-7e4f-8a9b-0c1d2e3f4a5b"

const article = {
	title: "The Long Read",
	url: "https://example.com/essays/long-read",
	siteName: "Example Magazine",
}

describe("highlightShareText", () => {
	it("quotes the highlight, adds the note under it and credits the article with its link", () => {
		const { markdown, html } = highlightShareText({
			exact: "First sentence.",
			note: "Worth remembering.",
			article,
		})
		expect(markdown).toBe(
			"> First sentence.\n\nWorth remembering.\n\n— [The Long Read](https://example.com/essays/long-read), Example Magazine",
		)
		expect(html).toBe(
			'<blockquote><p>First sentence.</p></blockquote><p>Worth remembering.</p><p>— <a href="https://example.com/essays/long-read">The Long Read</a>, Example Magazine</p>',
		)
	})

	it("leaves the note out when asked, and when there is none", () => {
		const without = highlightShareText({ exact: "Quote.", note: "Private.", article }, false)
		expect(without.markdown).not.toContain("Private")
		expect(without.html).not.toContain("Private")
		expect(highlightShareText({ exact: "Quote.", note: "  ", article }).markdown).toBe(
			"> Quote.\n\n— [The Long Read](https://example.com/essays/long-read), Example Magazine",
		)
	})

	it("keeps each paragraph of the quote inside the blockquote, with tidy spaces", () => {
		const { markdown, html } = highlightShareText({
			exact: "One   line\n\n\n  Two\tlines ",
			note: null,
			article,
		})
		expect(markdown.split("\n\n—")[0]).toBe("> One line\n>\n> Two lines")
		expect(html).toContain("<blockquote><p>One line</p><p>Two lines</p></blockquote>")
	})

	it("points a note's links at the linked articles' originals, never at the reader's library", () => {
		const B = "0193a5f1-2c3d-7e4f-8a9b-0c1d2e3f4a5c"
		const { markdown, html } = highlightShareText({
			exact: "Quote.",
			note: `See [Other piece](/read/${A}) and [Gone](/read/${B})\nand [Odd](/read/${A})`,
			article,
			linkUrls: { [A]: "https://other.example/piece (1)" },
		})
		// A target with no original known keeps its title, as text.
		expect(markdown).toContain(
			"See [Other piece](https://other.example/piece%20%281%29) and Gone\n\nand [Odd](https://other.example/piece%20%281%29)",
		)
		expect(markdown).not.toContain("/read/")
		expect(html).toContain(
			'<p>See <a href="https://other.example/piece%20(1)">Other piece</a> and Gone</p>',
		)
		// Without any originals, every link is its title.
		const bare = highlightShareText({ exact: "Q", note: `See [Other piece](/read/${A})`, article })
		expect(bare.markdown).toContain("\n\nSee Other piece\n\n")
	})

	it("gives a link without a title its address's host to click", () => {
		const { markdown } = highlightShareText({
			exact: "Q",
			note: `See [](/read/${A})`,
			article,
			linkUrls: { [A]: "https://other.example/piece" },
		})
		expect(markdown).toContain("\n\nSee [other.example](https://other.example/piece)\n\n")
	})

	it("links only web addresses from a note", () => {
		const { markdown, html } = highlightShareText({
			exact: "Q",
			note: `[Trap](/read/${A})`,
			article,
			linkUrls: { [A]: "javascript:alert(1)" },
		})
		expect(markdown).toContain("\n\nTrap\n\n")
		expect(html).not.toContain("javascript")
	})

	it("escapes what would break the HTML or the Markdown link", () => {
		const { markdown, html } = highlightShareText({
			exact: "a < b & <script>",
			note: '"quoted" <b>',
			article: {
				title: "Brackets [and] more",
				url: "https://example.com/a_(b) c?x=1&y=2",
				siteName: null,
			},
		})
		expect(markdown).toContain(
			"[Brackets \\[and\\] more](https://example.com/a_%28b%29%20c?x=1&y=2)",
		)
		expect(html).toContain("<p>a &lt; b &amp; &lt;script&gt;</p>")
		expect(html).toContain("<p>&quot;quoted&quot; &lt;b&gt;</p>")
		expect(html).toContain('href="https://example.com/a_(b)%20c?x=1&amp;y=2"')
	})

	it("names the article by its site, then its host, when it has no title", () => {
		const bySite = highlightShareText({
			exact: "Q",
			note: null,
			article: { ...article, title: null },
		})
		expect(bySite.markdown).toContain("— [Example Magazine](https://example.com/essays/long-read)")
		expect(bySite.markdown).not.toContain(", Example Magazine")
		const byHost = highlightShareText({
			exact: "Q",
			note: null,
			article: { title: "  ", url: "https://www.example.org/x", siteName: null },
		})
		expect(byHost.markdown).toContain("— [example.org](https://www.example.org/x)")
	})

	it("does not link anything but a web address", () => {
		const { markdown, html } = highlightShareText({
			exact: "Q",
			note: null,
			article: { title: "Local", url: "javascript:alert(1)", siteName: null },
		})
		expect(markdown).toContain("— Local")
		expect(markdown).not.toContain("javascript")
		expect(html).not.toContain("javascript")
	})
})
