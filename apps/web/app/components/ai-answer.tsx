import type { AiCitation } from "@klipstack/db"
import { Fragment } from "react"
import { cn } from "~/lib/utils"

/** Stands for citation `n` inside the text while it is parsed: no answer contains it. */
const MARK = "\u{E000}"

/**
 * An answer's text with its light Markdown (paragraphs, "- " and "1. " lists, "## " headings,
 * **bold**, *italics*) and a number on a stroke of highlighter ink after the words each citation
 * supports.
 */
export function AiAnswer({
	text,
	citations,
	onCite,
	citeLabel,
	heading = (title) => title,
}: {
	text: string
	citations: AiCitation[]
	onCite?: (citation: AiCitation) => void
	citeLabel: (n: number) => string
	/** A heading's title as shown: the brief's are in English whatever the language. */
	heading?: (title: string) => string
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
			{paragraphs(marked).flatMap(({ at, text }) =>
				// Where it starts in the answer: stable while the answer streams in.
				blocks(text).map((block, b) => {
					const key = `${at}:${b}`
					if (block.kind === "heading")
						return (
							<h3 key={key} className="mt-1 text-xs font-medium text-muted-fg">
								{heading(block.lines[0]!.replace(MARKS, ""))}
							</h3>
						)
					if (block.kind === "p") return <p key={key}>{inline(block.lines.join("\n"), chip)}</p>
					const List = block.kind === "ol" ? "ol" : "ul"
					return (
						<List
							key={key}
							className={cn(
								"flex flex-col gap-1.5 pl-4",
								block.kind === "ol" ? "list-decimal" : "list-disc",
							)}
						>
							{block.lines.map((line, i) => (
								// oxlint-disable-next-line react/no-array-index-key -- an item's place is its identity while it streams
								<li key={i}>{inline(line, chip)}</li>
							))}
						</List>
					)
				}),
			)}
		</div>
	)
}

/** A list item's start: "- " or "* ". */
const BULLET = /^\s*[-*]\s+/
/** A numbered item's start: "1. ". */
const NUMBERED = /^\s*\d+[.)]\s+/
const HEADING = /^#{1,3}\s+/
const MARKS = new RegExp(`${MARK}\\d+${MARK}`, "g")

type Block = { kind: "heading" | "p" | "ul" | "ol"; lines: string[] }

/** A paragraph's lines as headings, lists and text, each list item without its marker. */
function blocks(text: string): Block[] {
	const out: Block[] = []
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
		else out.push({ kind, lines: [kind === "p" ? line : bare] })
	}
	return out
}

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
