/**
 * A block's sentences, as `[start, end]` offsets in its text, trimmed: by the language's sentence
 * rules (`Intl.Segmenter`). Pieces without a letter or digit (a lone "—", a list number) join the
 * sentence before them, or the one after at the start.
 */
export function splitSentences(text: string, lang: string): Array<[number, number]> {
	const out: Array<[number, number]> = []
	const parts =
		typeof Intl !== "undefined" && Intl.Segmenter
			? Array.from(new Intl.Segmenter(lang || "en", { granularity: "sentence" }).segment(text))
			: [{ segment: text, index: 0 }]
	let carry: number | null = null
	for (const part of parts) {
		let start = part.index
		let end = part.index + part.segment.length
		while (start < end && /\s/.test(text[start] ?? "")) start++
		while (end > start && /\s/.test(text[end - 1] ?? "")) end--
		if (start === end) continue
		if (!/[\p{L}\p{N}]/u.test(text.slice(start, end))) {
			const last = out.at(-1)
			if (last) last[1] = end
			else carry ??= start
			continue
		}
		out.push([carry ?? start, end])
		carry = null
	}
	return out
}
