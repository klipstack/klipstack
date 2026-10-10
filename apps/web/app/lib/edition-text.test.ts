import { describe, expect, it } from "vitest"
import { parseEditionText, plainEditionText } from "./edition-text"

const text = (t: string) => ({ kind: "text", text: t })
const link = (t: string, url: string) => ({ kind: "link", text: t, url })

describe("parseEditionText", () => {
	it("makes http and https Markdown links into links", () => {
		expect(parseEditionText("See [one](https://a.example/x) and [two](http://b.example).")).toEqual(
			[
				[
					text("See "),
					link("one", "https://a.example/x"),
					text(" and "),
					link("two", "http://b.example"),
					text("."),
				],
			],
		)
	})

	it("leaves every other address as typed", () => {
		for (const source of [
			"[click](javascript:alert(1))",
			"[click](JAVASCRIPT:alert(1))",
			"[data](data:text/html,<b>hi</b>)",
			"[read](/read/0193a5f1-2c3d-7e4f-8a9b-0c1d2e3f4a5b)",
			"[rel](//evil.example)",
			"[spaced](https://a.example/with space)",
			'<a href="https://a.example">html</a>',
		])
			expect(parseEditionText(source)).toEqual([[text(source)]])
	})

	it("keeps parentheses inside an address", () => {
		expect(parseEditionText("[Mercury](https://en.wikipedia.org/wiki/Mercury_(planet)).")).toEqual([
			[link("Mercury", "https://en.wikipedia.org/wiki/Mercury_(planet)"), text(".")],
		])
	})

	it("shows the address when the link has no text", () => {
		expect(parseEditionText("[](https://a.example)")).toEqual([
			[link("https://a.example", "https://a.example")],
		])
	})

	it("splits paragraphs at blank lines and keeps single line breaks", () => {
		expect(parseEditionText("one\ntwo\n\n\n  \nthree\n")).toEqual([
			[text("one\ntwo")],
			[text("three")],
		])
		expect(parseEditionText("")).toEqual([])
	})
})

describe("plainEditionText", () => {
	it("reads links as their text, on one line", () => {
		expect(plainEditionText("Read [this](https://a.example).\n\nThen  that.")).toBe(
			"Read this. Then that.",
		)
	})
})
