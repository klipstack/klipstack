import { sentences } from "./sentences"
import type { AnswerEvent, Citation } from "./types"

/** One marker: sentence numbers in brackets, `[12]`, `[12, 14]` or `[12-14]`. */
const MARKER = String.raw`\[\d+(?:[ \t]*[,–—-][ \t]*\d+)*\]`
/** Markers written together, with the spaces before them: they cite together. */
const RUN = new RegExp(String.raw`[ \t]*${MARKER}(?:[ \t]*${MARKER})*`, "g")
/** What a run is made of: what has come is held back from the last character that isn't. */
const IN_RUN = /[ \t\d,–—\-[\]]/
/** Held back at most: no run is longer. */
const HELD_MAX = 64
/** A marker the answer was cut off in. */
const CUT = /[ \t]*\[[\d \t,–—-]*$/
/**
 * Limits on what the model's markers can cite. The answer is untrusted output: `[1-9999]` would
 * otherwise cite the whole article, as many times as it is written.
 */
const SENTENCES_MAX = 10
const CITATIONS_MAX = 50

/**
 * Reads the model's answer as it streams, turning its markers into citations: each citation is
 * the range of the sentences it names, placed where the marker was, right after the words it
 * supports. Neighbouring sentences make one citation, of at most ten. The markers, and the spaces
 * before them, are left out of the text; numbers the article doesn't have are dropped.
 */
export function citationReader(article: string) {
	const list = sentences(article)
	let held = ""
	let written = 0
	let cited = 0

	function citations(run: string): Citation[] {
		const numbers = new Set<number>()
		for (const marker of run.matchAll(/\[([^\]]*)\]/g))
			for (const part of marker[1]!.split(",")) {
				const [from, to = from] = part.split(/[–—-]/).map((n) => Number(n.trim()))
				for (let n = Math.max(1, from!); n <= Math.min(to!, list.length); n++) numbers.add(n)
			}
		const sorted = [...numbers].sort((a, b) => a - b)
		const out: Citation[] = []
		for (let i = 0; i < sorted.length; i++) {
			const first = sorted[i]!
			let last = first
			while (sorted[i + 1] === sorted[i]! + 1) {
				i++
				if (sorted[i]! - first < SENTENCES_MAX) last = sorted[i]!
			}
			const start = list[first - 1]!.start
			const end = list[last - 1]!.end
			out.push({ start, end, exact: article.slice(start, end), at: written })
		}
		return out
	}

	function read(text: string): AnswerEvent[] {
		const events: AnswerEvent[] = []
		const say = (piece: string) => {
			if (!piece) return
			events.push({ type: "text", text: piece })
			written += piece.length
		}
		let from = 0
		for (const run of text.matchAll(RUN)) {
			say(text.slice(from, run.index))
			for (const citation of citations(run[0])) {
				if (cited++ >= CITATIONS_MAX) break
				events.push({ type: "citation", citation })
			}
			from = run.index + run[0].length
		}
		say(text.slice(from))
		return events
	}

	return {
		/** The text that has come: what can be written of it, and its citations, in order. */
		push(delta: string): AnswerEvent[] {
			const text = held + delta
			let from = text.length
			while (from > text.length - HELD_MAX && from > 0 && IN_RUN.test(text[from - 1]!)) from--
			held = text.slice(from)
			return read(text.slice(0, from))
		},
		/** The answer has ended: the rest of it, without a marker it was cut off in. */
		end(): AnswerEvent[] {
			const text = held.replace(CUT, "")
			held = ""
			return read(text)
		},
	}
}
