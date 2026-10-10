import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { escapeHtml, localImages, readerHtml, sampleText } from "./reader-html"
import { pageScript, pageScriptHash } from "./reader-page.generated"

const page = {
	title: "Tom & Jerry <script>",
	byline: "example.com · 5 min",
	html: "<p>Body.</p>",
	highlights: [
		{
			id: "h1",
			quote: "a </script><script>alert(1)</script>",
			color: "green" as const,
			start: 0,
			end: 5,
		},
	],
}

/** The page's settings, as its script reads them. */
const configOf = (html: string) =>
	JSON.parse(/<script type="application\/json" id="klip-config">(.*?)<\/script>/s.exec(html)![1]!)

describe("readerHtml", () => {
	it("escapes the title and byline, and puts the article's HTML as it is", () => {
		const html = readerHtml(page)
		expect(html).toContain("<h1>Tom &amp; Jerry &lt;script&gt;</h1>")
		expect(html).toContain('<p class="byline">example.com · 5 min</p>')
		expect(html).toContain("<article><p>Body.</p></article>")
	})

	it("shows the posts the article was saved through under the byline, names escaped", () => {
		const html = readerHtml({
			...page,
			via: [
				{
					author: "Ann <b>",
					siteName: "X.com",
					html: '<p>Read <a href="https://e.com">this</a></p>',
				},
			],
		})
		expect(html).toContain(
			'<p class="byline">example.com · 5 min</p>\n<aside class="via"><p class="via-by">Shared by Ann &lt;b&gt; · X.com</p><p>Read <a href="https://e.com">this</a></p></aside>\n</header>',
		)
		expect(readerHtml(page)).not.toContain('class="via"')
	})

	it("hands the highlights to the script as data their text can't end", () => {
		const html = readerHtml(page)
		const scripts = html.match(/<script[^>]*>[\s\S]*?<\/script>/g) ?? []
		expect(scripts).toHaveLength(2)
		expect(scripts[0]).toContain("\\u003c/script>")
		expect(configOf(html).highlights).toEqual([
			{
				id: "h1",
				color: 1,
				quote: "a </script><script>alert(1)</script>",
				prefix: "",
				suffix: "",
				start: 0,
				end: 5,
			},
		])
	})

	it("runs only its own script: the policy names its hash", () => {
		const html = readerHtml(page)
		const hash = createHash("sha256").update(pageScript).digest("base64")
		expect(pageScriptHash).toBe(`sha256-${hash}`)
		expect(html).toContain(`<script>${pageScript}</script>`)
		expect(html).toContain(
			`content="default-src 'none'; script-src '${pageScriptHash}'; style-src 'unsafe-inline'; img-src file: https: data:; base-uri 'none'; form-action 'none'"`,
		)
	})

	it("opens at a highlight when asked, with the position to fall back on", () => {
		expect(configOf(readerHtml({ ...page, position: 0.4, highlight: "h1" }))).toMatchObject({
			position: 0.4,
			highlight: "h1",
		})
	})

	it("opens at a saved position between 0.05 and 0.95, and at the top otherwise", () => {
		expect(configOf(readerHtml({ ...page, position: 0.4 }))).toMatchObject({
			position: 0.4,
			highlight: null,
		})
		for (const position of [undefined, 0.02, 0.97, Number.NaN])
			expect(configOf(readerHtml({ ...page, position })).position).toBe(0)
	})

	it("sizes the text by the system text size, within bounds", () => {
		expect(readerHtml(page)).toContain("html { font-size: 16px; }")
		expect(readerHtml({ ...page, fontScale: 1.5 })).toContain("html { font-size: 24px; }")
		expect(readerHtml({ ...page, fontScale: 3.12 })).toContain("html { font-size: 40px; }")
		expect(readerHtml({ ...page, fontScale: 0.5 })).toContain("html { font-size: 13.6px; }")
	})
})

describe("sampleText", () => {
	it("keeps the words, without tags", () => {
		expect(sampleText("<p>Hola, <em>mundo</em>.</p>\n<p>Otra.</p>")).toBe("Hola, mundo . Otra.")
	})
})

describe("localImages", () => {
	const a = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"
	const b = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c"

	it("empties stored images, marks them with their id, and lists each id once", () => {
		const html = `<p><img src="https://klipstack.com/assets/${a}" alt="One"></p><img src="http://localhost:5180/assets/${b}"><img src="https://klipstack.com/assets/${a}" alt="Again">`
		expect(localImages(html)).toEqual({
			html: `<p><img data-asset="${a}" alt="One"></p><img data-asset="${b}"><img data-asset="${a}" alt="Again">`,
			ids: [a, b],
		})
	})

	it("gives images of known size their place before they load", () => {
		const html = `<img src="https://klipstack.com/assets/${a}" alt="One"><img src="https://klipstack.com/assets/${b}">`
		const sizes = new Map([
			[a, { width: 1200, height: 800 }],
			[b, { width: null, height: null }],
		])
		expect(localImages(html, sizes).html).toBe(
			`<img data-asset="${a}" style="width: min(100%, 1200px); aspect-ratio: 1200 / 800" alt="One"><img data-asset="${b}">`,
		)
	})

	it("leaves other images alone", () => {
		const html = `<img src="https://example.com/photo.jpg" alt="x">`
		expect(localImages(html)).toEqual({ html, ids: [] })
	})
})

describe("escapeHtml", () => {
	it("escapes the five characters", () => {
		expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
			"&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
		)
	})
})
