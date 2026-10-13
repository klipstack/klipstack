/** Snippets of found text with the matching words marked. Safe to import from client code. */

/** Text in runs; `match` marks a word the search found. */
export type Snippet = Array<{ text: string; match?: true }>

/** Lowercase, without accents: how search compares words. */
export function foldWord(word: string): string {
	return word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
}

const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu

/** Markdown links read as their text; whitespace, line breaks included, as one space. */
function plain(text: string): string {
	return text
		.replace(/\[([^\]]*)\]\([^)\s]*\)/g, "$1")
		.replace(/\s+/g, " ")
		.trim()
}

/**
 * Up to about `max` characters of `text` around the first word `isMatch` accepts (given the word
 * folded), with every accepted word marked. Without one, the start of the text.
 */
export function snippet(text: string, isMatch: (folded: string) => boolean, max = 240): Snippet {
	const flat = plain(text)
	const words = [...flat.matchAll(WORD)].map((m) => ({
		start: m.index,
		end: m.index + m[0].length,
		match: isMatch(foldWord(m[0])),
	}))
	let from = 0
	let to = flat.length
	if (flat.length > max) {
		const first = words.find((w) => w.match)
		// A little context before the first match, unless it is near the start anyway.
		const lead = first ? Math.max(0, first.start - Math.floor(max / 4)) : 0
		from = lead === 0 ? 0 : (words.find((w) => w.start >= lead)?.start ?? lead)
		to = Math.min(flat.length, from + max)
		if (to < flat.length) {
			// End at a word's end, not inside one.
			const last = words.filter((w) => w.end <= to && w.start >= from).pop()
			if (last) to = last.end
		}
	}
	const runs: Snippet = []
	const push = (piece: string, match?: true) => {
		if (!piece) return
		const prev = runs[runs.length - 1]
		if (prev && !prev.match && !match) prev.text += piece
		else runs.push(match ? { text: piece, match } : { text: piece })
	}
	if (from > 0) push("…")
	let at = from
	for (const w of words) {
		if (!w.match || w.start < from || w.end > to) continue
		push(flat.slice(at, w.start))
		push(flat.slice(w.start, w.end), true)
		at = w.end
	}
	push(flat.slice(at, to))
	if (to < flat.length) push("…")
	return runs
}

/** Accepts the words Postgres matched (`matchedWords`), compared folded, hyphenated parts included. */
export function matchedIn(words: string[]): (folded: string) => boolean {
	const set = new Set<string>()
	for (const word of words) {
		set.add(foldWord(word))
		for (const part of word.match(WORD) ?? []) set.add(foldWord(part))
	}
	return (folded) => set.has(folded)
}

/** Accepts words that start with one of the typed words, as find-as-you-type matches them. */
export function startsWithAny(typed: string[]): (folded: string) => boolean {
	const prefixes = typed.map(foldWord).filter(Boolean)
	return (folded) => prefixes.some((p) => folded.startsWith(p))
}

/** The snippet as plain text, for labels and accessible names. */
export function snippetText(runs: Snippet): string {
	return runs.map((r) => r.text).join("")
}
