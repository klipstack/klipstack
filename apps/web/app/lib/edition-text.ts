/**
 * Intro and note text on a public edition page. It is plain text: only `[text](https://…)` and
 * `[text](http://…)` become links. Anything else stays as typed, and React escapes it, so there is
 * nothing to sanitize. Framework-free.
 */
import { isHttpUrl } from "./editions"

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
	for (const match of text.matchAll(LINK)) {
		const url = match[2]!
		if (!isHttpUrl(url)) continue
		if (match.index > at) segments.push({ kind: "text", text: text.slice(at, match.index) })
		segments.push({ kind: "link", text: match[1] || url, url })
		at = match.index + match[0].length
	}
	if (at < text.length) segments.push({ kind: "text", text: text.slice(at) })
	return segments
}

/** The text as it reads, links as their text, on one line. For meta descriptions. */
export function plainEditionText(text: string): string {
	return parseEditionText(text)
		.map((paragraph) => paragraph.map((segment) => segment.text).join(""))
		.join(" ")
		.replace(/\s+/g, " ")
		.trim()
}
