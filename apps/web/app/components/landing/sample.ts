/**
 * The landing page's sample article: its sentences (copy in `home.demo.sentences`), the marks it
 * opens with, and the quote limit an edition of it would have.
 */
export const PARAGRAPHS = [
	["s1", "s2", "s3"],
	["s4", "s5", "s6"],
	["s7", "s8"],
] as const

export type SentenceId = (typeof PARAGRAPHS)[number][number]

export const SENTENCES: readonly SentenceId[] = PARAGRAPHS.flat()

/** The highlighted sentences. */
export type Marks = Partial<Record<SentenceId, true>>

export const INITIAL_MARKS: Marks = { s5: true, s8: true }

/** The sentence that carries the sample margin note, while it is highlighted. */
export const NOTED: SentenceId = "s5"

/**
 * The quote limit of an edition: a tenth of the article, never more than 150 words. The sample
 * stands for a 600-word article, so marking most of it shows the limit.
 */
export const QUOTE_MAX = Math.min(150, Math.floor(0.1 * 600))

export function countWords(text: string): number {
	return text.split(/\s+/).filter(Boolean).length
}

export interface Quote {
	id: SentenceId
	text: string
	/** False once the quote would pass QUOTE_MAX: the edition leaves it out. */
	fits: boolean
}

/** The edition's quotes, in article order, and the words they use. */
export function editionQuotes(
	marks: Marks,
	textOf: (id: SentenceId) => string,
): { quotes: Quote[]; used: number } {
	let used = 0
	const quotes: Quote[] = []
	for (const id of SENTENCES) {
		if (!marks[id]) continue
		const text = textOf(id)
		const words = countWords(text)
		const fits = used + words <= QUOTE_MAX
		if (fits) used += words
		quotes.push({ id, text, fits })
	}
	return { quotes, used }
}

/** The highlight color (`--hl` in app.css), and its solid form for lines. */
export const HL_BG = "marker"
export const HL_SOLID_BORDER = "border-(--hl-solid)"
