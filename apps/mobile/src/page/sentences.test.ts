import { describe, expect, it } from "vitest"
import { splitSentences } from "./sentences"

describe("splitSentences", () => {
	const sentences = (text: string, lang = "en") =>
		splitSentences(text, lang).map(([start, end]) => text.slice(start, end))

	it("splits by the language's sentence rules, trimmed", () => {
		expect(sentences(" One reason. Two reasons?  Three! ")).toEqual([
			"One reason.",
			"Two reasons?",
			"Three!",
		])
		expect(sentences("¿Qué pasa? Nada, todo bien.", "es")).toEqual([
			"¿Qué pasa?",
			"Nada, todo bien.",
		])
	})

	it("joins pieces with nothing to say to their neighbor", () => {
		expect(sentences("Done. — ")).toEqual(["Done. —"])
		expect(sentences("— Then it rained.")).toEqual(["— Then it rained."])
	})

	it("finds nothing in empty text", () => {
		expect(splitSentences("   ", "en")).toEqual([])
	})
})
