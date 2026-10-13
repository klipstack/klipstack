/** The highlights API's filter and the search terms of the Notebook and the API; safe to import from client code. */
import { HIGHLIGHT_FILTERS, type HighlightFilter } from "@klipstack/api-contract/enums"

export { HIGHLIGHT_FILTERS, type HighlightFilter }

export interface SearchTerm {
	text: string
	/** Quoted: matched as written (bar case and accents), no word variants. */
	phrase: boolean
}

/**
 * Search terms: "quoted text" is one phrase (straight or curly quotes), everything else a word.
 * An unclosed quote counts as plain words. At most 8 terms. NUL characters are dropped (Postgres
 * text cannot hold them).
 */
export function searchTerms(q: string): SearchTerm[] {
	const terms: SearchTerm[] = []
	for (const m of q
		.replaceAll("\u0000", "")
		.slice(0, 200)
		.matchAll(/["“”]([^"“”]*)["“”]|[^\s"“”]+/g)) {
		const text = (m[1] ?? m[0]).trim().replace(/\s+/g, " ")
		if (text) terms.push({ text, phrase: m[1] !== undefined })
	}
	return terms.slice(0, 8)
}
