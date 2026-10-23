import { dateLocale } from "./i18n"
/** Reading aloud: the pure parts. The voices and the player are in `modules/klip-speech`. */

export type SpeechLanguage = "en" | "es"

/** Playback speeds offered, in the order the speed button cycles through them. */
export const SPEEDS = [1, 1.25, 1.5] as const

export function nextSpeed(current: number): number {
	const at = (SPEEDS as readonly number[]).indexOf(current)
	return SPEEDS[(at + 1) % SPEEDS.length]!
}

export function speedLabel(speed: number): string {
	return `${speed.toLocaleString(dateLocale)}×`
}

const STOPWORDS: Record<SpeechLanguage, Set<string>> = {
	en: new Set(
		"the and of to is that it in for with you this was are on be as have not but they at by from".split(
			" ",
		),
	),
	es: new Set(
		"el la de que y en los las un una es por con para del se no lo al como más pero sus le ya".split(
			" ",
		),
	),
}

/**
 * The language to read an article in: the one extraction found (`en`, `en-US`, `es`), else a
 * guess from the text's commonest words. Null for other languages, or when unsure.
 */
export function speechLanguage(
	declared: string | null | undefined,
	text: string,
): SpeechLanguage | null {
	const code = declared?.toLowerCase().split(/[-_]/)[0]
	if (code === "en" || code === "es") return code
	if (code) return null
	const words =
		text
			.slice(0, 5000)
			.toLowerCase()
			.match(/\p{L}+/gu) ?? []
	const count = (language: SpeechLanguage) => words.filter((w) => STOPWORDS[language].has(w)).length
	const en = count("en")
	const es = count("es")
	if (Math.max(en, es) < 5) return null
	if (en > es * 1.5) return "en"
	if (es > en * 1.5) return "es"
	return null
}

export type SpeechPrefs = {
	/** Chosen voice per language; the first offered when unset. */
	voices: Partial<Record<SpeechLanguage, string>>
	speed: number
}

export const DEFAULT_SPEECH_PREFS: SpeechPrefs = { voices: {}, speed: 1 }

/** Stored JSON to settings; anything unknown falls back to the default. */
export function parseSpeechPrefs(raw: string | null | undefined): SpeechPrefs {
	try {
		const value = JSON.parse(raw ?? "") as Partial<SpeechPrefs> | null
		const voices: SpeechPrefs["voices"] = {}
		for (const language of ["en", "es"] as const) {
			const voice = value?.voices?.[language]
			if (typeof voice === "string" && /^[a-z]{2}_[a-z]+$/.test(voice)) voices[language] = voice
		}
		const speed = SPEEDS.find((s) => s === value?.speed) ?? DEFAULT_SPEECH_PREFS.speed
		return { voices, speed }
	} catch {
		return DEFAULT_SPEECH_PREFS
	}
}

/** `330 MB`, `4 MB`, `512 KB`. */
export function formatBytes(bytes: number): string {
	if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`
	return `${Math.max(1, Math.round(bytes / 1000))} KB`
}

/** Kokoro reads about 17 characters a second at 1× (measured on long articles). */
const CHARACTERS_PER_SECOND = 17

/** Minutes left from sentence `index` on, at `speed`; at least 1 while anything is left. */
export function minutesLeft(
	sentences: ReadonlyArray<string>,
	index: number,
	speed: number,
): number {
	const characters = sentences.slice(Math.max(0, index)).reduce((sum, s) => sum + s.length, 0)
	if (!characters) return 0
	return Math.max(1, Math.round(characters / CHARACTERS_PER_SECOND / speed / 60))
}

/** How far into the article sentence `index` starts, 0–1, by characters. */
export function progressAt(sentences: ReadonlyArray<string>, index: number): number {
	const total = sentences.reduce((sum, s) => sum + s.length, 0)
	if (!total) return 0
	const before = sentences.slice(0, Math.max(0, index)).reduce((sum, s) => sum + s.length, 0)
	return before / total
}
