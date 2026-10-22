/**
 * How much of a person's own text a public page shows: a shared highlight's quote and note, and an
 * edition's notes. A little over a post, so no public page republishes an article. The pages cut it
 * as they read it; what is stored stays whole, for its owner. Framework-free.
 */

/** Most words of a quote, or of a note, a public page shows. */
const WORDS_MAX = 100
/** Most characters, for long words and for scripts written without spaces. */
const CHARS_MAX = 600

/**
 * Where a public page cuts this text, or null when it shows whole: after the last word within both
 * limits. When that word ends before half the characters (a word longer than the rest, or text
 * without spaces), the cut falls at the character limit instead, never inside a surrogate pair.
 */
function cutAt(text: string): number | null {
	let words = 0
	let end = 0
	for (const word of text.matchAll(/\S+/g)) {
		const wordEnd = word.index + word[0].length
		if (words === WORDS_MAX) return end
		if (wordEnd > CHARS_MAX) {
			if (end >= CHARS_MAX / 2) return end
			const low = text.charCodeAt(CHARS_MAX)
			return low >= 0xdc00 && low <= 0xdfff ? CHARS_MAX - 1 : CHARS_MAX
		}
		words += 1
		end = wordEnd
	}
	return null
}

/** Plain text as a public page shows it, with "…" where it was cut. */
export function clipText(text: string): string {
	const cut = cutAt(text)
	return cut === null ? text : `${text.slice(0, cut)}…`
}

/** A piece of a line of text: plain text, or a link, written as `source` and read as its `shown` text. */
export type Piece = { text: string } | { source: string; shown: string }

const shown = (piece: Piece) => ("text" in piece ? piece.text : piece.shown)

/**
 * Text with links, given as its lines of pieces, as a public page shows it: measured as it reads (a
 * link by its text), its line breaks kept. A link the cut falls inside is left out whole, so no
 * half link is ever shown. Null when it shows whole.
 */
export function clipLines(lines: Piece[][]): string | null {
	let left = cutAt(lines.map((line) => line.map(shown).join("")).join("\n"))
	if (left === null) return null
	const kept: string[] = []
	for (const line of lines) {
		let written = ""
		for (const piece of line) {
			const length = shown(piece).length
			if (length <= left) {
				written += "text" in piece ? piece.text : piece.source
				left -= length
				continue
			}
			kept.push(`${written}${"text" in piece ? piece.text.slice(0, left) : ""}…`)
			return kept.join("\n")
		}
		if (left === 0) {
			kept.push(`${written}…`)
			return kept.join("\n")
		}
		kept.push(written)
		left -= 1
	}
	return null
}
