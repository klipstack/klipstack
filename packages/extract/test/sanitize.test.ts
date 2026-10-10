import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"
import { sanitizeHtml } from "../src/sanitize"

const parse = (html: string) =>
	new JSDOM(`<!doctype html><body>${sanitizeHtml(html)}</body>`).window.document.body

// The reader renders this output inside the app's page. These run the sanitizer alone, without
// `clean.ts` in front of it, so each case checks the allowlist itself.
describe("sanitizeHtml", () => {
	it("drops scripts, styles and their content", () => {
		const body = parse(
			"<p>a</p><script>alert(1)</script><style>p{color:red}</style><noscript>n</noscript><p>b</p>",
		)
		expect(body.querySelector("script, style")).toBeNull()
		expect(body.textContent).not.toContain("alert")
		expect(body.textContent).not.toContain("color:red")
	})

	it("drops forms and their controls", () => {
		const body = parse(
			'<form action="https://evil.example/" method="post"><label for="p">Password</label>' +
				'<input id="p" type="password" name="p"><select><option>x</option></select>' +
				'<textarea>t</textarea><button formaction="https://evil.example/">Go</button></form>',
		)
		expect(body.querySelector("form, input, button, select, option, textarea, label")).toBeNull()
		expect(body.innerHTML).not.toContain("evil.example")
	})

	it("drops embedded documents and SVG", () => {
		const body = parse(
			'<iframe src="https://evil.example/"></iframe><object data="x"></object>' +
				'<embed src="x"><svg onload="alert(1)"><circle r="1"/></svg><template><p>t</p></template>',
		)
		expect(body.querySelector("iframe, object, embed, svg, template")).toBeNull()
	})

	it("drops event handlers, styles and remote backgrounds", () => {
		const body = parse(
			'<p onclick="alert(1)" style="color:red">x</p>' +
				'<table background="https://tracker.example/t.gif"><tr><td background="https://tracker.example/u.gif">c</td></tr></table>' +
				'<img src="https://example.com/a.png" onerror="alert(1)" alt="a">',
		)
		expect(body.innerHTML).not.toMatch(/onclick|onerror|style=|background=/)
		expect(body.innerHTML).not.toContain("tracker.example")
		expect(body.querySelector("img")?.getAttribute("src")).toBe("https://example.com/a.png")
	})

	it("keeps only http(s), mailto and in-page links and sources", () => {
		const body = parse(
			'<a href="javascript:alert(1)">j</a><a href="data:text/html,x">d</a>' +
				'<a href="https://example.com/">h</a><a href="mailto:a@example.com">m</a><a href="#fn1">f</a>' +
				'<img src="data:image/png;base64,AAAA" alt="d"><img src="https://example.com/b.png" srcset="javascript:alert(1) 1x" alt="s">',
		)
		const hrefs = Array.from(body.querySelectorAll("a")).map((a) => a.getAttribute("href"))
		expect(hrefs).toEqual([null, null, "https://example.com/", "mailto:a@example.com", "#fn1"])
		const imgs = Array.from(body.querySelectorAll("img"))
		expect(imgs).toHaveLength(1)
		expect(imgs[0]?.hasAttribute("srcset")).toBe(false)
	})

	it("checks the original image URL that Markdown exports use", () => {
		const body = parse(
			'<img src="https://example.com/a.png" data-original-src="javascript:alert(1)">' +
				'<img src="https://example.com/b.png" data-original-src="https://example.com/o.png">',
		)
		const originals = Array.from(body.querySelectorAll("img")).map((i) =>
			i.getAttribute("data-original-src"),
		)
		expect(originals).toEqual([null, "https://example.com/o.png"])
	})

	it("keeps new-tab links from reaching their opener", () => {
		const body = parse(
			'<a href="https://example.com/" target="_blank">n</a><a href="https://example.com/" target="_top">t</a>',
		)
		const [blank, top] = Array.from(body.querySelectorAll("a"))
		expect(blank?.getAttribute("target")).toBe("_blank")
		expect(blank?.getAttribute("rel")).toBe("noopener noreferrer")
		expect(top?.hasAttribute("target")).toBe(false)
	})

	it("drops tags outside the list but keeps their text", () => {
		const body = parse(
			'<center><font color="#fff" face="x">Hidden?</font></center><nav>menu</nav><p popover id="x">p</p>',
		)
		expect(body.querySelector("center, font, nav")).toBeNull()
		expect(body.textContent).toContain("Hidden?")
		expect(body.innerHTML).not.toMatch(/color=|face=|popover/)
	})

	it("keeps only the highlighter's class names, and only a no-referrer policy", () => {
		const body = parse(
			'<pre><code class="hljs fixed inset-0 z-50 language-js">x</code></pre>' +
				'<img src="https://example.com/a.png" referrerpolicy="unsafe-url">' +
				'<img src="https://example.com/b.png" referrerpolicy="no-referrer">',
		)
		expect(body.querySelector("code")?.className).toBe("hljs language-js")
		const policies = Array.from(body.querySelectorAll("img")).map((i) =>
			i.getAttribute("referrerpolicy"),
		)
		expect(policies).toEqual([null, "no-referrer"])
	})

	it("keeps article structure, code classes and MathML", () => {
		const body = parse(
			'<h2 id="s">Section</h2><figure><img src="https://example.com/c.png" alt="c"><figcaption>cap</figcaption></figure>' +
				'<pre><code class="language-ts">let a = 1</code></pre><p class="promo">x</p>' +
				'<math display="block"><mrow><mi>x</mi><mo stretchy="false">(</mo><msup><mi>e</mi><mn>2</mn></msup></mrow></math>',
		)
		expect(body.querySelector("h2")?.id).toBe("s")
		expect(body.querySelector("figure img")).not.toBeNull()
		expect(body.querySelector("code")?.className).toBe("language-ts")
		expect(body.querySelector("p")?.hasAttribute("class")).toBe(false)
		expect(body.querySelector("math")?.getAttribute("display")).toBe("block")
		expect(body.querySelector("mo")?.getAttribute("stretchy")).toBe("false")
		expect(body.querySelector("msup mn")?.textContent).toBe("2")
	})

	it("refuses data and ARIA attributes except the ones it names", () => {
		const body = parse(
			'<img src="https://example.com/d.png" data-original-src="https://o.example/d.png" data-x="y" aria-label="z" alt="d">',
		)
		const img = body.querySelector("img")
		expect(img?.getAttribute("data-original-src")).toBe("https://o.example/d.png")
		expect(img?.hasAttribute("data-x")).toBe(false)
		expect(img?.hasAttribute("aria-label")).toBe(false)
	})
})
