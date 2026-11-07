import type { ArticleTranslation } from "@klipstack/sdk"
import { describe, expect, it } from "vitest"
import { translationBar, translationMenu } from "./translation"

// A French article for an English reader, with credits to spare.
const french: ArticleTranslation = {
	available: true,
	target: "en",
	language: "fr",
	translated: false,
	from: null,
	stale: false,
	status: null,
	credits: 3,
	left: 10,
	tooLong: false,
	elsewhere: 0,
}
const none = { never: [], always: [] }
const actions = (bar: ReturnType<typeof translationBar>) =>
	bar?.actions.map(({ action, label, disabled }) => ({ action, label, disabled }))

describe("translationBar", () => {
	it("offers a translation into the account's language, with its cost", () => {
		const bar = translationBar(french, { languages: none })
		expect(bar?.text).toBe("This article is in French.")
		expect(bar?.note).toBe("Uses 3 translation credits. 10 credits left this month.")
		expect(actions(bar)).toEqual([
			{ action: "translate", label: "Translate to English", disabled: false },
			{ action: "not-now", label: "Not now", disabled: false },
			{ action: "never", label: "Never translate French", disabled: false },
		])
	})

	it("says what is missing, and can't translate, without the credits", () => {
		const bar = translationBar({ ...french, credits: 3, left: 2 }, { languages: none })
		expect(bar?.note).toBe("This article needs 3 credits. 2 credits left this month.")
		expect(bar?.actions[0]).toMatchObject({ action: "translate", disabled: true })
	})

	it("costs nothing for a translation made before", () => {
		expect(translationBar({ ...french, credits: 0 }, { languages: none })?.note).toBe(
			"It was translated before: no credits needed.",
		)
	})

	it("says an article too long can't be translated, and offers no button for it", () => {
		const bar = translationBar({ ...french, tooLong: true }, { languages: none })
		expect(bar?.note).toBe("This article is too long to translate.")
		expect(bar?.actions.map((a) => a.action)).toEqual(["not-now", "never"])
	})

	it("offers none in the reader's language, a language never translated, or after Not now", () => {
		expect(translationBar({ ...french, language: "en" }, { languages: none })).toBeNull()
		expect(translationBar({ ...french, language: null }, { languages: none })).toBeNull()
		expect(translationBar(french, { languages: { never: ["fr"], always: [] } })).toBeNull()
		expect(translationBar(french, { languages: none, dismissed: true })).toBeNull()
		expect(translationBar({ ...french, available: false }, { languages: none })).toBeNull()
	})

	it("says it is translating, and that it failed, with a retry", () => {
		const pending = translationBar({ ...french, status: "pending" }, { languages: none })
		expect(pending).toMatchObject({ text: "Translating to English…", pending: true, actions: [] })
		const failed = translationBar({ ...french, status: "failed" }, { languages: none })
		expect(failed?.text).toBe("The article couldn't be translated. Your credits are back.")
		expect(actions(failed)).toEqual([{ action: "translate", label: "Try again", disabled: false }])
	})

	it("names where a translation came from, with the original and Always translate", () => {
		const translated = { ...french, translated: true, language: "en", from: "fr", elsewhere: 2 }
		const bar = translationBar(translated, { languages: none })
		expect(bar?.text).toBe("Translated from French. 2 highlights are on the original text.")
		expect(actions(bar)).toEqual([
			{ action: "original", label: "Show original text", disabled: false },
			{ action: "always", label: "Always translate French", disabled: false },
		])
		// Always already: only the original.
		expect(
			translationBar(translated, { languages: { never: [], always: ["fr"] } })?.actions,
		).toHaveLength(1)
	})

	it("shows the original read-only, with the way back to the translation", () => {
		const translated = { ...french, translated: true, language: "en", from: "fr", elsewhere: 1 }
		const bar = translationBar(translated, { languages: none, original: true })
		expect(bar?.text).toBe(
			"You're reading the original text, in French. To highlight or ask AI, go back to the translation. 1 highlight is on the translation.",
		)
		expect(actions(bar)).toEqual([
			{ action: "translation", label: "Show translation", disabled: false },
		])
	})
})

describe("translationMenu", () => {
	it("translates an article in another language, and puts a translation's original back", () => {
		expect(translationMenu(french)).toEqual({ action: "translate", label: "Translate to English" })
		expect(translationMenu({ ...french, translated: true, language: "en", from: "fr" })).toEqual({
			action: "use-original",
			label: "Use Original Language",
		})
		expect(translationMenu({ ...french, status: "pending" })).toBeNull()
		expect(translationMenu({ ...french, language: "en" })).toBeNull()
	})
})
