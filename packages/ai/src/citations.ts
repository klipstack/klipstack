import type { Citation } from "./types"

/** A provider's document citation: its offsets in the text we sent, and the text it quotes. */
export interface CitedRange {
	start?: number
	end?: number
	citedText: string
}

/**
 * Turns a provider's citation into a range of the article, checked against the text: the offsets
 * as given when they hold the quoted text, else the quote's occurrence nearest to them. Whitespace
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

/** The `anthropic` provider metadata of a document citation, when it has offsets in the text. */
export function anthropicCitation(metadata: unknown): CitedRange | null {
	const value = (metadata as { anthropic?: Record<string, unknown> } | undefined)?.anthropic
	if (!value || typeof value.citedText !== "string") return null
	const index = (key: string) =>
		typeof value[key] === "number" ? (value[key] as number) : undefined
	return {
		citedText: value.citedText,
		start: index("startCharIndex"),
		end: index("endCharIndex"),
	}
}
