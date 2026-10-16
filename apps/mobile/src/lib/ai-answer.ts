import type { AiCitation } from "@klipstack/sdk"

/**
 * An answer's light Markdown (paragraphs, "- " and "1. " lists, "## " headings, **bold**,
 * *italics*) as blocks of runs, with a citation's number after the words it supports: what
 * `AiAnswer` draws. The web reader's `ai-answer.tsx`, as data.
 */

/** A piece of a line: text, bold or italic, or citation `n` (0-based, into the citations). */
export type Run =
	| { kind: "text"; text: string; bold?: boolean; italic?: boolean }
	| { kind: "cite"; n: number }

export type AnswerBlock =
	| { kind: "heading"; text: string; key: string }
	| { kind: "p"; runs: Run[]; key: string }
	| { kind: "ul" | "ol"; items: Run[][]; start: number; key: string }

/** Stands for citation `n` inside the text while it is parsed: no answer contains it. */
const MARK = "\u{E000}"
const MARKS = new RegExp(`${MARK}\\d+${MARK}`, "g")
const BULLET = /^\s*[-*]\s+/
const NUMBERED = /^\s*\d+[.)]\s+/
const HEADING = /^#{1,3}\s+/

export function answerBlocks(text: string, citations: readonly AiCitation[]): AnswerBlock[] {
	return paragraphs(withMarks(text, citations)).flatMap(({ at, text: paragraph }) =>
		lineBlocks(paragraph).map((block, b): AnswerBlock => {
			const key = `${at}:${b}`
			if (block.kind === "heading")
				return { kind: "heading", text: block.lines[0]!.replace(MARKS, "").trim(), key }
			if (block.kind === "p") return { kind: "p", runs: inline(block.lines.join("\n")), key }
			return { kind: block.kind, items: block.lines.map(inline), start: block.start, key }
		}),
	)
}

type LineBlock = { kind: "heading" | "p" | "ul" | "ol"; lines: string[]; start: number }

/** A paragraph's lines as headings, lists and text, each list item without its marker. */
function lineBlocks(text: string): LineBlock[] {
	const out: LineBlock[] = []
	for (const line of text.split("\n")) {
		const kind = HEADING.test(line)
			? "heading"
			: BULLET.test(line)
				? "ul"
				: NUMBERED.test(line)
					? "ol"
					: "p"
		const bare = line.replace(kind === "ul" ? BULLET : kind === "ol" ? NUMBERED : HEADING, "")
		const last = out.at(-1)
		if (last && last.kind === kind && kind !== "heading") last.lines.push(bare)
		// A list the model broke up with blank lines goes on counting.
		else if (kind === "ol")
			out.push({ kind, lines: [bare], start: Number.parseInt(line.trim(), 10) })
		else out.push({ kind, lines: [kind === "p" ? line : bare], start: 1 })
	}
	return out
}

/** The answer's paragraphs, with where each starts: a key that holds while it streams in. */
function paragraphs(text: string): Array<{ at: number; text: string }> {
	const out: Array<{ at: number; text: string }> = []
	const pattern = /[^\n]+(?:\n(?!\n)[^\n]*)*/g
	for (let match = pattern.exec(text); match; match = pattern.exec(text))
		if (match[0].trim()) out.push({ at: match.index, text: match[0].trim() })
	return out
}

/** Puts a mark for each citation at its place in the text, last first so earlier places hold. */
function withMarks(text: string, citations: readonly AiCitation[]): string {
	let out = text
	const order = citations.map((c, n) => ({ at: Math.min(c.at, text.length), n }))
	order.sort((a, b) => b.at - a.at || b.n - a.n)
	for (const { at, n } of order) out = `${out.slice(0, at)}${MARK}${n}${MARK}${out.slice(at)}`
	return out
}

/** **bold** and *italics*, and the citation marks within them. */
function inline(text: string): Run[] {
	const runs: Run[] = []
	const pattern = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*/g
	let last = 0
	for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
		runs.push(...marks(text.slice(last, match.index), {}))
		runs.push(...marks(match[1] ?? match[2] ?? "", match[1] ? { bold: true } : { italic: true }))
		last = match.index + match[0].length
	}
	runs.push(...marks(text.slice(last), {}))
	return runs
}

function marks(text: string, style: { bold?: boolean; italic?: boolean }): Run[] {
	// Odd parts are citation numbers.
	return text.split(MARK).flatMap((part, i): Run[] => {
		if (i % 2) return [{ kind: "cite", n: Number(part) }]
		return part ? [{ kind: "text", text: part, ...style }] : []
	})
}

/** The answer's text without its Markdown, for copying. */
export function plainAnswer(text: string): string {
	return text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*\s][^*]*)\*/g, "$1")
}

/**
 * What an answer says in one sentence: the bold sentence it opens with, else its first sentence.
 */
export function answerLead(text: string): string {
	const bold = /^\s*\*\*(.+?)\*\*(?!\*)/.exec(text)
	if (bold) return plainAnswer(bold[1]!).trim()
	const plain = plainAnswer(text)
		.replace(/^\s*(?:\*\*|#{1,3}\s+|[-*]\s+|\d+[.)]\s+)/, "")
		.trim()
	return (/^[\s\S]+?[.!?](?=\s|$)/.exec(plain)?.[0] ?? plain).trim()
}

/**
 * A brief's sections, opened by these headings, in English whatever the language
 * (`briefSystemPrompt` in `@klipstack/ai`), as the app names them.
 */
const BRIEF_SECTIONS: Record<string, string> = {
	"key claims": "Key claims",
	"keep in mind": "Keep in mind",
	parts: "Parts",
}

/** A brief's heading as shown: forgiving of case and a trailing colon, which a model may add. */
export function briefHeading(heading: string): string {
	return BRIEF_SECTIONS[heading.trim().replace(/:$/, "").toLowerCase()] ?? heading
}

/** The brief in a few lines: its gist, or the bullets of a brief written before the sections. */
export function briefSummary(text: string): string {
	const heading = text.search(/^##\s/m)
	if (heading >= 0) return text.slice(0, heading).trim()
	return text
		.split("\n")
		.map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
		.filter(Boolean)
		.join(" ")
}
