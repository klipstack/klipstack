import { describe, expect, it } from "vitest"
import { editionNoteFromNote, parseEditionText, plainEditionText } from "./edition-text"

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

describe("editionNoteFromNote", () => {
	const ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"

	it("starts an empty edition note from the private one, links to articles as their titles", () => {
		expect(editionNoteFromNote("", `  Pairs with [Deep work](/read/${ID}).\nKeep it.  `, 500)).toBe(
			"Pairs with Deep work.\nKeep it.",
		)
	})

	it("adds it after what is already written, as a paragraph of its own", () => {
		expect(editionNoteFromNote("Why read it:\n", "Meetings cost afternoons.", 500)).toBe(
			"Why read it:\n\nMeetings cost afternoons.",
		)
	})

	it("adds nothing when the note is empty or already in", () => {
		expect(editionNoteFromNote("Draft", "  \n ", 500)).toBeNull()
		expect(
			editionNoteFromNote("Intro\n\nMeetings cost afternoons.", "Meetings cost afternoons.", 500),
		).toBeNull()
	})

	it("stays within the length the server takes", () => {
		expect(editionNoteFromNote("abc", "defgh", 6)).toBe("abc\n\nd")
	})
})
