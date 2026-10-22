/**
 * Intro and note text on a public edition page. It is plain text: only `[text](https://…)` and
 * `[text](http://…)` become links. Anything else stays as typed, and React escapes it, so there is
 * nothing to sanitize. Framework-free.
 */
import { isHttpUrl } from "./editions"
import { parse } from "./note-links"
import { clipLines, type Piece } from "./public-cut"

export type TextSegment =
	| { kind: "text"; text: string }
	| { kind: "link"; text: string; url: string }

// Link text holds no bracket or line break. The address has no spaces; it may hold parentheses one
// level deep, as Wikipedia's do.
const LINK = /\[([^[\]\n]*)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)/gi

/** Paragraphs, split at blank lines. A single line break stays inside its paragraph. */
export function parseEditionText(text: string): TextSegment[][] {
	return text
		.split(/\n\s*\n/)
		.map((paragraph) => paragraph.replace(/^\n+|\n+$/g, ""))
		.filter(Boolean)
		.map(parseParagraph)
}

function parseParagraph(text: string): TextSegment[] {
	const segments: TextSegment[] = []
	let at = 0
	for (const link of linksIn(text)) {
		if (link.index > at) segments.push({ kind: "text", text: text.slice(at, link.index) })
		segments.push({ kind: "link", text: link.text, url: link.url })
		at = link.index + link.source.length
	}
	if (at < text.length) segments.push({ kind: "text", text: text.slice(at) })
	return segments
}

/** The links in this text, where each starts, as written and as they read. */
function* linksIn(text: string) {
	for (const match of text.matchAll(LINK)) {
		const url = match[2]!
		if (isHttpUrl(url)) yield { index: match.index, source: match[0], text: match[1] || url, url }
	}
}

/** A note as a public edition page shows it, cut to `clipLines`' limits, its paragraphs kept. */
export function clipEditionText(text: string): string {
	const lines = text.split("\n").map((line) => {
		const pieces: Piece[] = []
		let at = 0
		for (const link of linksIn(line)) {
			pieces.push({ text: line.slice(at, link.index) }, { source: link.source, shown: link.text })
			at = link.index + link.source.length
		}
		pieces.push({ text: line.slice(at) })
		return pieces
	})
	return clipLines(lines) ?? text
}

/** The text as it reads, links as their text, on one line. For meta descriptions. */
export function plainEditionText(text: string): string {
	return parseEditionText(text)
		.map((paragraph) => paragraph.map((segment) => segment.text).join(""))
		.join(" ")
		.replace(/\s+/g, " ")
		.trim()
}

/**
 * The edition note started from the reader's private note (`documents.note`): the note's text
 * after what is already written, links to the reader's own articles as their titles, as the
 * edition's readers cannot open them, and its lines as paragraphs. Null when there is nothing to add: no note, or it is in
 * already.
 */
export function editionNoteFromNote(editionNote: string, note: string, max: number): string | null {
	// Each line of a note is a paragraph; in an edition note a paragraph ends at a blank line.
	const text = parse(note)
		.map((line) =>
			line
				.map((s) => (s.kind === "text" ? s.text : s.title))
				.join("")
				.trim(),
		)
		.filter(Boolean)
		.join("\n\n")
	if (!text || editionNote.includes(text)) return null
	const written = editionNote.trimEnd()
	return (written ? `${written}\n\n${text}` : text).slice(0, max)
}
