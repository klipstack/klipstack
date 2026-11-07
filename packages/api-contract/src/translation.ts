import { z } from "zod"

/**
 * Translating an article costs credits from a monthly allowance, by its length: one per started
 * thousand words of the original, so a short post costs one and a long essay several. The web
 * reader, the API and the mobile app count the same way.
 */

/** Words of the original one credit pays for. */
export const TRANSLATION_CREDIT_WORDS = 1000

/** Longest original that can be translated, in words: 20 credits. */
export const TRANSLATION_WORDS_MAX = 20_000

/** Most languages an account can list as never translated, and as always translated. */
export const TRANSLATION_LANGUAGES_MAX = 50

/**
 * What the account does with articles in a language: never offered a translation (one it reads),
 * always translated as they are saved (credits allowing), or offered one (the default).
 */
export const TRANSLATION_CHOICES = ["never", "always", "ask"] as const
export type TranslationChoice = (typeof TRANSLATION_CHOICES)[number]

/** An article's language: ISO 639-1, or 639-3 where a language has no two-letter code. */
export const LanguageCode = z
	.string()
	.regex(/^[a-z]{2,3}$/, "A two- or three-letter language code.")

/** The languages articles are translated into: the app's. */
export const TRANSLATION_LANGUAGES = ["en", "es"] as const
export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number]

/**
 * The words of a text, as a reader counts them in its language: Chinese and Japanese have no
 * spaces between words, and are split by `Intl.Segmenter` like any other.
 */
export function translationWords(text: string): number {
	let words = 0
	for (const segment of new Intl.Segmenter("und", { granularity: "word" }).segment(text))
		if (segment.isWordLike) words++
	return words
}

/** The credits translating an original of this many words costs: at least one. */
export function translationCredits(words: number): number {
	return Math.max(1, Math.ceil(words / TRANSLATION_CREDIT_WORDS))
}
