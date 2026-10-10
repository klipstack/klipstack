import { describe, expect, it } from "vitest"
import { minutesLeft, parseSpeechPrefs, speechLanguage } from "./speech"

describe("speechLanguage", () => {
	it("takes the language extraction found, with or without a region", () => {
		expect(speechLanguage("en", "")).toBe("en")
		expect(speechLanguage("es-AR", "")).toBe("es")
		expect(speechLanguage("EN_us", "")).toBe("en")
	})

	it("has no voices for other languages", () => {
		expect(speechLanguage("fr", "the and of to is that it in for with")).toBeNull()
	})

	it("guesses from common words when extraction found none", () => {
		expect(
			speechLanguage(null, "The cat sat on the mat, and it was not happy with the rain that day."),
		).toBe("en")
		expect(
			speechLanguage(
				null,
				"El gato se sentó en la alfombra y no estaba contento con la lluvia de ese día.",
			),
		).toBe("es")
	})

	it("doesn't guess from too little text", () => {
		expect(speechLanguage(undefined, "Hello there")).toBeNull()
	})
})

describe("parseSpeechPrefs", () => {
	it("keeps known speeds and well-formed voice ids", () => {
		expect(parseSpeechPrefs('{"voices":{"en":"am_michael","es":"x"},"speed":1.25}')).toEqual({
			voices: { en: "am_michael" },
			speed: 1.25,
		})
	})
})

describe("minutesLeft", () => {
	const sentences = ["a".repeat(1020), "b".repeat(1020)]

	it("estimates the time left at the speed", () => {
		expect(minutesLeft(sentences, 0, 1)).toBe(2)
		expect(minutesLeft(sentences, 1, 1)).toBe(1)
		expect(minutesLeft(sentences, 2, 1)).toBe(0)
	})
})
