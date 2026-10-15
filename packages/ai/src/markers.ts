import { sentences } from "./sentences"
import type { AnswerEvent, Citation } from "./types"

/** One marker: sentence numbers in brackets, `[12]`, `[12, 14]` or `[12-14]`. */
const MARKER = String.raw`\[\d+(?:[ \t]*[,–-][ \t]*\d+)*\]`
/** Markers written together, with the spaces before them: they cite together. */
const RUN = new RegExp(String.raw`[ \t]*${MARKER}(?:[ \t]*${MARKER})*`, "g")
/** The end of what has come that may still become part of a run: spaces, markers, a "[1". */
const TAIL = /(?:[ \t]|\[[\d \t,–-]*\]?)*$/

/**
 * Reads the model's answer as it streams, turning its markers into citations: each citation is
 * the range of the sentences it names, placed where the marker was, right after the words it
 * supports. Neighbouring sentences make one citation. The markers, and the spaces before them,
 * are left out of the text; numbers the article doesn't have are dropped.
 */
export function citationReader(article: string) {
	const list = sentences(article)
	let held = ""
	let written = 0
	const cited: Citation[] = []

	function citations(run: string): Citation[] {
		const numbers = new Set<number>()
		for (const marker of run.matchAll(/\[([^\]]*)\]/g))
			for (const part of marker[1]!.split(",")) {
				const [from, to = from] = part.split(/[–-]/).map((n) => Number(n.trim()))
				for (let n = Math.max(1, from!); n <= Math.min(to!, list.length); n++) numbers.add(n)
			}
		const sorted = [...numbers].sort((a, b) => a - b)
		const out: Citation[] = []
		for (let i = 0; i < sorted.length; i++) {
			const first = sorted[i]!
			while (sorted[i + 1] === sorted[i]! + 1) i++
			const start = list[first - 1]!.start
			const end = list[sorted[i]! - 1]!.end
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
			for (const c of citations(run[0])) {
				if (cited.some((d) => d.start === c.start && d.end === c.end && d.at === c.at)) continue
				cited.push(c)
				events.push({ type: "citation", citation: c })
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
			const tail = TAIL.exec(text)![0].length
			held = text.slice(text.length - tail)
			return read(text.slice(0, text.length - tail))
		},
		/** The answer has ended: the rest of it. */
		end(): AnswerEvent[] {
			const text = held
			held = ""
			return read(text)
		},
	}
}
