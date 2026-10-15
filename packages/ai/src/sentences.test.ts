import { describe, expect, it } from "vitest"
import { numberedText, sentences } from "./sentences"

// As extracted pages often are: lines broken inside sentences, indented, paragraphs apart.
const text =
	"\n\t\tMakers need long\n\t\tblocks of time. Managers work in slots!\n\t\t\n\t\t\n\t\tWhy? Because   meetings cost makers more."

describe("sentences", () => {
	it("finds each sentence's range in the text, without the whitespace around it", () => {
		const list = sentences(text)
		expect(list.map((s) => text.slice(s.start, s.end))).toEqual([
			"Makers need long\n\t\tblocks of time.",
			"Managers work in slots!",
			"Why?",
			"Because   meetings cost makers more.",
		])
		expect(list.map((s) => s.text)).toEqual([
			"Makers need long blocks of time.",
			"Managers work in slots!",
			"Why?",
			"Because meetings cost makers more.",
		])
	})

	it("has none in an empty or blank text", () => {
		expect(sentences("")).toEqual([])
		expect(sentences(" \n\t\n ")).toEqual([])
	})
})

describe("numberedText", () => {
	it("puts one numbered sentence per line, and a blank line between paragraphs", () => {
		expect(numberedText(text)).toBe(
			[
				"[1] Makers need long blocks of time.",
				"[2] Managers work in slots!",
				"",
				"[3] Why?",
				"[4] Because meetings cost makers more.",
			].join("\n"),
		)
	})
})
