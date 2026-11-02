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

describe("cleanArticleHtml link cards", () => {
	const card = (href: string, title: string) =>
		`<figure><a href="${href}"><div><p>${title}</p><p>A description of that other post, as the card shows it.</p></div><img src="https://example.com/thumb.png"></a></figure>`

	it("drops cards to the site's own posts and keeps cards to other sites", () => {
		const html = `${prose(3)}${card("/other-post", "My other post")}${prose(3)}${card("https://twitter.com/someone/status/1", "A tweet worth quoting")}${prose(3)}`
		const out = cleanArticleHtml(html, { url: "https://www.example.com/post", title: null })
		expect(out).not.toContain("My other post")
		expect(out).toContain("A tweet worth quoting")
		expect(out).toContain("Paragraph 2")
	})

	it("keeps a post that is mostly cards to the site's own posts", () => {
		const cards = Array.from({ length: 6 }, (_, i) => card(`/post-${i}`, `Best post ${i}`)).join("")
		const out = cleanArticleHtml(`<p>My best posts this year:</p>${cards}`, { url, title: null })
		expect(out).toContain("Best post 0")
		expect(out).toContain("Best post 5")
	})

	it("keeps same-site links that are the article's own content, and media beside a card", () => {
		const heading = '<a href="/part-2"><h2>Part 2: The setup</h2></a>'
		const self = `<a href="https://example.com/post/#intro"><div><p>Introduction</p><p>Where the post starts.</p></div></a>`
		const beside = `<div>${card("/related", "A related post").replace(/<\/?figure>/g, "")}<img src="https://example.com/chart.png"></div>`
		const contents = `<ul><li><a href="/series/1"><h3>Part 1</h3><p>Setup</p></a></li></ul>`
		const quote = `<blockquote><a href="/earlier"><p>Quoted title</p><p>Quoted text from my earlier post.</p></a></blockquote>`
		const list = `<a href="/guide"><p>The full guide covers:</p><ul><li>Installing the tool</li></ul></a>`
		const html = `${prose(4)}${heading}${prose(4)}${self}${prose(4)}${beside}${prose(4)}${contents}${quote}${list}${prose(4)}`
		const out = cleanArticleHtml(html, {
			url: "https://example.com/post?utm_source=x",
			title: null,
		})
		expect(out).toContain("Part 2: The setup")
		expect(out).toContain("Where the post starts.")
		expect(out).toContain("Part 1")
		expect(out).toContain("Quoted text from my earlier post.")
		expect(out).toContain("Installing the tool")
		expect(out).not.toContain("A related post")
		expect(out).toContain("chart.png")
	})

	it("drops a figure left with only its caption, and keeps figures with media", () => {
		const html = `${prose(3)}<figure><iframe src="https://www.youtube.com/embed/x"></iframe><figcaption>in video form</figcaption></figure><figure><img src="https://example.com/a.png"><figcaption>A photo</figcaption></figure>${prose(3)}`
		const out = cleanArticleHtml(html, { url, title: null })
		expect(out).not.toContain("in video form")
		expect(out).toContain("A photo")
	})
})
