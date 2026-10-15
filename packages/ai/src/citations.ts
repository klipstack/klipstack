import type { Citation } from "./types"

/** A citation kept with an answer: its offsets in the article, and the text it quotes. */
export interface CitedRange {
	start?: number
	end?: number
	citedText: string
}

/**
 * Finds a citation's quote in a text, such as a new version of its article: at the offsets given
 * when they still hold it, else the occurrence nearest to them. Whitespace
 * at either end is left out, so the chip points at words. Null when the quote is not in the text:
 * a citation never points at words that aren't there.
 */
export function citationRange(text: string, cited: CitedRange, at: number): Citation | null {
	const quote = cited.citedText
	if (!quote.trim()) return null
	let start = -1
	if (
		cited.start !== undefined &&
		cited.end !== undefined &&
		text.slice(cited.start, cited.end) === quote
	)
		start = cited.start
	else start = nearest(text, quote, cited.start ?? 0)
	if (start < 0) return null
	let end = start + quote.length
	while (start < end && /\s/.test(text[start]!)) start++
	while (end > start && /\s/.test(text[end - 1]!)) end--
	return { start, end, exact: text.slice(start, end), at }
}

function nearest(text: string, quote: string, near: number): number {
	let best = -1
	for (let i = text.indexOf(quote); i >= 0; i = text.indexOf(quote, i + 1)) {
		if (best < 0 || Math.abs(i - near) < Math.abs(best - near)) best = i
	}
	return best
}
