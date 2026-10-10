import { describe, expect, it } from "vitest"
import { normalizeHref, type RichDoc, toEditionText, toRichDoc } from "./edition-rich-text"

const link = (text: string, href: string) => ({
	type: "text" as const,
	text,
	marks: [{ type: "link" as const, attrs: { href } }],
})

describe("toRichDoc", () => {
	it("makes paragraphs, line breaks and links", () => {
		const doc = toRichDoc("One [two](https://a.example/2)\nthree.\n\nFour.")
		expect(doc).toEqual({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{ type: "text", text: "One " },
						link("two", "https://a.example/2"),
						{ type: "hardBreak" },
						{ type: "text", text: "three." },
					],
				},
				{ type: "paragraph", content: [{ type: "text", text: "Four." }] },
			],
		})
	})

	it("starts an empty text with one empty paragraph", () => {
		expect(toRichDoc("")).toEqual({ type: "doc", content: [{ type: "paragraph" }] })
	})

	it("keeps what is not a web link as text", () => {
		const doc = toRichDoc("[x](javascript:alert(1))")
		expect(doc.content[0]!.content).toEqual([{ type: "text", text: "[x](javascript:alert(1))" }])
	})
})

describe("toEditionText", () => {
	it("reads back what it was given", () => {
		for (const text of [
			"Plain.",
			"One [two](https://a.example/2)\nthree.\n\nFour.",
			"See [Mercury](https://en.wikipedia.org/wiki/Mercury_%28planet%29).",
			"Line\n\nbreaks\nkept",
		])
			expect(toEditionText(toRichDoc(text))).toBe(text)
	})

	it("writes links the page can read, whatever their text and address", () => {
		const doc: RichDoc = {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{ type: "text", text: "a" },
						link(" [b] ", "https://a.example/x (y)"),
						{ type: "text", text: "c" },
					],
				},
			],
		}
		expect(toEditionText(doc)).toBe("a [b](https://a.example/x%20%28y%29) c")
	})

	it("drops links that are not web addresses, and empty paragraphs at the end", () => {
		const doc: RichDoc = {
			type: "doc",
			content: [
				{ type: "paragraph", content: [link("mail", "mailto:a@example.com")] },
				{ type: "paragraph" },
				{ type: "paragraph" },
			],
		}
		expect(toEditionText(doc)).toBe("mail")
	})

	it("gives a link with no text its address", () => {
		const doc: RichDoc = {
			type: "doc",
			content: [{ type: "paragraph", content: [link("  ", "https://a.example/")] }],
		}
		expect(toEditionText(doc)).toBe("  [https://a.example/](https://a.example/)")
	})
})

describe("normalizeHref", () => {
	it("takes web addresses, with or without the scheme", () => {
		expect(normalizeHref(" example.com/a ")).toBe("https://example.com/a")
		expect(normalizeHref("http://example.com")).toBe("http://example.com")
		expect(normalizeHref("javascript:alert(1)")).toBeNull()
		expect(normalizeHref("  ")).toBeNull()
	})
})
