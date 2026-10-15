/** A sentence of the article: its range in the text, and its words with the spaces collapsed. */
export interface Sentence {
	start: number
	end: number
	text: string
}

const segmenter = new Intl.Segmenter("en", { granularity: "sentence" })
/** A paragraph: text up to a blank line. */
const PARAGRAPH = /[^\n]*\S[\s\S]*?(?=\n[ \t]*\n|$)/g

let last: { text: string; list: Sentence[] } | undefined

/**
 * The article's sentences, in order: what a citation points at. Paragraphs end at blank lines,
 * sentences where `Intl.Segmenter` ends them. The locale is fixed, so a version is always split
 * the same way and its prompt stays cached.
 */
export function sentences(text: string): Sentence[] {
	// The prompt and the stream ask for the same text's sentences, one after the other.
	if (last?.text === text) return last.list
	const list: Sentence[] = []
	for (const paragraph of text.matchAll(PARAGRAPH)) {
		// The segmenter ends a sentence at every line break, and pages break lines mid-sentence: it
		// reads the paragraph with each run of spaces as one, mapped back to the text.
		let flat = ""
		const at: number[] = []
		for (const run of paragraph[0].matchAll(/\s+|\S+/g)) {
			const space = /\s/.test(run[0])
			for (let i = 0; i < (space ? 1 : run[0].length); i++) at.push(paragraph.index + run.index + i)
			flat += space ? " " : run[0]
		}
		for (const segment of segmenter.segment(flat)) {
			let start = at[segment.index]!
			let end = at[segment.index + segment.segment.length - 1]! + 1
			while (start < end && /\s/.test(text[start]!)) start++
			while (end > start && /\s/.test(text[end - 1]!)) end--
			if (end > start) list.push({ start, end, text: text.slice(start, end).replace(/\s+/g, " ") })
		}
	}
	last = { text, list }
	return list
}

/**
 * The article as the model reads it: one sentence per line, numbered from 1 so that it can cite
 * them, with a blank line between paragraphs.
 */
export function numberedText(text: string): string {
	const list = sentences(text)
	return list
		.map((s, i) => {
			const gap = i > 0 && /\n[ \t]*\n/.test(text.slice(list[i - 1]!.end, s.start)) ? "\n" : ""
			return `${gap}[${i + 1}] ${s.text}`
		})
		.join("\n")
}

/** The numbers (from 1) of the sentences a range of the text overlaps. */
export function sentencesIn(text: string, start: number, end: number): number[] {
	return sentences(text).flatMap((s, i) => (s.end > start && s.start < end ? [i + 1] : []))
}
