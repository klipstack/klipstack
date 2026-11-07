import { francAll } from "franc"

/**
 * The languages detection may answer, by franc's ISO 639-3 code, with the ISO 639-1 code the app
 * stores (as `<html lang>` gives it). franc weighs all of its 187 languages, and a listed one wins
 * only near the top (`NEAR_TOP`): franc puts Scots a hair above much English, but a text in a
 * language outside the list answers null rather than its nearest listed neighbour.
 */
const CODES: Record<string, string> = {
	eng: "en",
	spa: "es",
	por: "pt",
	fra: "fr",
	ita: "it",
	deu: "de",
	nld: "nl",
	pol: "pl",
	ces: "cs",
	slk: "sk",
	ron: "ro",
	hun: "hu",
	swe: "sv",
	dan: "da",
	nob: "nb",
	fin: "fi",
	ell: "el",
	tur: "tr",
	rus: "ru",
	ukr: "uk",
	bul: "bg",
	srp: "sr",
	hrv: "hr",
	slv: "sl",
	lit: "lt",
	lav: "lv",
	ekk: "et",
	cat: "ca",
	eus: "eu",
	cmn: "zh",
	jpn: "ja",
	kor: "ko",
	arb: "ar",
	heb: "he",
	pes: "fa",
	hin: "hi",
	ben: "bn",
	tha: "th",
	vie: "vi",
	ind: "id",
	zsm: "ms",
	tgl: "tl",
	urd: "ur",
	tam: "ta",
}
/** Characters of text below which a guess is not worth making. */
const MIN_CHARS = 40
/** franc reads this many characters at most: longer texts are sampled. */
const SAMPLE_CHARS = 2048
/** How close to franc's best score (1) a listed language must come. */
const NEAR_TOP = 0.9

/**
 * The language a text is written in, as an ISO 639-1 code, or null when it is too short to tell
 * or in a language not listed above. A long text is sampled at its start, middle and end, so a
 * preface or a quote doesn't decide it alone.
 */
export function detectLanguage(text: string): string | null {
	const plain = text.replace(/\s+/g, " ").trim()
	if (plain.length < MIN_CHARS) return null
	const third = Math.floor(SAMPLE_CHARS / 3)
	const sample =
		plain.length <= SAMPLE_CHARS
			? plain
			: [0.1, 0.45, 0.8]
					.map((at) =>
						plain.slice(Math.floor(plain.length * at), Math.floor(plain.length * at) + third),
					)
					.join(" ")
	const [best] = francAll(sample, { minLength: MIN_CHARS }).filter(([code]) => code in CODES)
	return best && best[1] >= NEAR_TOP ? CODES[best[0]]! : null
}
