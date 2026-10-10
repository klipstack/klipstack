import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"
import { canonicalText, countWords, plainText } from "./text"

function body(html: string) {
	return new JSDOM(`<!doctype html><body>${html}</body>`).window.document.body
}

describe("canonicalText", () => {
	it("concatenates text nodes without normalization", () => {
		const root = body("<p>Hello <b>bold</b> world</p>\n<p>Second</p>")
		expect(canonicalText(root)).toBe("Hello bold world\nSecond")
	})
	it("skips script and style", () => {
		const root = body("<p>a</p><script>var x = 1</script><style>p{}</style><p>b</p>")
		expect(canonicalText(root)).toBe("ab")
	})
	it("is stable across re-serialization (innerHTML round trip)", () => {
		const root = body("<p>One&nbsp;two</p><pre>\ncode\n</pre><ul><li>x</li></ul>")
		const first = canonicalText(root)
		const again = body(root.innerHTML)
		expect(canonicalText(again)).toBe(first)
	})
})

describe("plainText", () => {
	it("separates blocks and collapses whitespace", () => {
		const root = body("<h2>Title</h2><p>Some   text\n here.</p><ul><li>a</li><li>b</li></ul>")
		expect(plainText(root)).toBe("Title\n\nSome text here.\n\na\n\nb")
	})
})

describe("countWords", () => {
	it("counts unicode words", () => {
		expect(countWords("Hello, world! It's 2026 — año nuevo.")).toBe(6)
	})
})
