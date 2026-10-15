import type { AiCitation } from "@klipstack/db"
import { Fragment } from "react"

/** Stands for citation `n` inside the text while it is parsed: no answer contains it. */
const MARK = "\u{E000}"

/**
 * An answer's text with its light Markdown (paragraphs, "- " lists, **bold**, *italics*) and a number
 * on a stroke of highlighter ink after the words each citation supports.
 */
export function AiAnswer({
	text,
	citations,
	onCite,
	citeLabel,
}: {
	text: string
	citations: AiCitation[]
	onCite?: (citation: AiCitation) => void
	citeLabel: (n: number) => string
}) {
	const marked = withMarks(text, citations)
	const chip = (n: number) => {
		const citation = citations[n]
		if (!citation) return null
		return (
			<button
				type="button"
				disabled={!onCite}
				onClick={() => onCite?.(citation)}
				aria-label={citeLabel(n + 1)}
				title={citation.exact}
				className="cite-mark"
			>
				{n + 1}
			</button>
		)
	}
	return (
		<div className="flex flex-col gap-2">
			{paragraphs(marked).map(({ at, text }) => {
				// Where it starts in the answer: stable while the answer streams in.
				const lines = text.split("\n")
				if (!lines.every((line) => BULLET.test(line))) return <p key={at}>{inline(text, chip)}</p>
				return (
					<ul key={at} className="flex list-disc flex-col gap-1.5 pl-4">
						{lines.map((line, i) => (
							// oxlint-disable-next-line react/no-array-index-key -- a bullet's place is its identity while it streams
							<li key={i}>{inline(line.replace(BULLET, ""), chip)}</li>
						))}
					</ul>
				)
			})}
		</div>
	)
}

/** A list item's start: "- " or "* ". */
const BULLET = /^\s*[-*]\s+/

/** The answer's paragraphs, with where each starts. */
function paragraphs(text: string): Array<{ at: number; text: string }> {
	const out: Array<{ at: number; text: string }> = []
	const pattern = /[^\n]+(?:\n(?!\n)[^\n]*)*/g
	for (let match = pattern.exec(text); match; match = pattern.exec(text))
		if (match[0].trim()) out.push({ at: match.index, text: match[0].trim() })
	return out
}

/** Puts a mark for each citation at its place in the text, last first so earlier places hold. */
function withMarks(text: string, citations: AiCitation[]): string {
	let out = text
	const order = citations.map((c, n) => ({ at: Math.min(c.at, text.length), n }))
	order.sort((a, b) => b.at - a.at || b.n - a.n)
	for (const { at, n } of order) out = `${out.slice(0, at)}${MARK}${n}${MARK}${out.slice(at)}`
	return out
}

type Chip = (n: number) => React.ReactNode

/** **bold** and *italics*, and the citation marks within them. */
function inline(text: string, chip: Chip): React.ReactNode[] {
	const nodes: React.ReactNode[] = []
	const pattern = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*/g
	let last = 0
	let key = 0
	for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
		nodes.push(...marks(text.slice(last, match.index), chip, key++))
		const inner = marks(match[1] ?? match[2] ?? "", chip, key++)
		nodes.push(match[1] ? <strong key={key++}>{inner}</strong> : <em key={key++}>{inner}</em>)
		last = match.index + match[0].length
	}
	nodes.push(...marks(text.slice(last), chip, key++))
	return nodes
}

function marks(text: string, chip: Chip, key: number): React.ReactNode[] {
	const nodes: React.ReactNode[] = []
	let at = 0
	// Odd parts are citation numbers.
	text.split(MARK).forEach((part, i) => {
		const id = `${key}:${at}`
		nodes.push(<Fragment key={id}>{i % 2 ? chip(Number(part)) : part}</Fragment>)
		at += part.length + 1
	})
	return nodes
}

/** The answer's text without its Markdown, for copying. */
export function plainAnswer(text: string): string {
	return text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*\s][^*]*)\*/g, "$1")
}
