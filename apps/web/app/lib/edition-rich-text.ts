/**
 * Edition text (the intro, the notes) as its editor holds it: paragraphs of text with line breaks
 * and links, as ProseMirror JSON. The stored text does not change: blank lines between paragraphs,
 * `[text](https://…)` links (`edition-text.ts`). Framework-free, so both ways can be tested.
 */
import { parseEditionText } from "./edition-text"
import { isHttpUrl, markdownUrl } from "./editions"

export interface LinkMark {
	type: "link"
	attrs: { href: string }
}
export type InlineNode = { type: "text"; text: string; marks?: LinkMark[] } | { type: "hardBreak" }
export interface RichParagraph {
	type: "paragraph"
	content?: InlineNode[]
}
export interface RichDoc {
	type: "doc"
	content: RichParagraph[]
}

/** The editor's document for a stored text. An empty text is one empty paragraph. */
export function toRichDoc(text: string): RichDoc {
	const paragraphs = parseEditionText(text)
	return {
		type: "doc",
		content: (paragraphs.length > 0 ? paragraphs : [[]]).map((segments) => {
			const content = segments.flatMap((segment): InlineNode[] =>
				segment.kind === "link"
					? [{ type: "text", text: segment.text, marks: [linkMark(segment.url)] }]
					: lines(segment.text),
			)
			return content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" }
		}),
	}
}

/** A single line break stays in its paragraph, as a break. ProseMirror has no empty text nodes. */
function lines(text: string): InlineNode[] {
	return text
		.split("\n")
		.flatMap((line, i): InlineNode[] => [
			...(i > 0 ? [{ type: "hardBreak" } as const] : []),
			...(line ? [{ type: "text", text: line } as const] : []),
		])
}

function linkMark(href: string): LinkMark {
	return { type: "link", attrs: { href } }
}

/** The text to store for the editor's document. Empty paragraphs at the end are dropped. */
export function toEditionText(doc: RichDoc): string {
	return doc.content
		.map((paragraph) => (paragraph.content ?? []).map(inlineText).join(""))
		.join("\n\n")
		.replace(/\s+$/, "")
}

function inlineText(node: InlineNode): string {
	if (node.type === "hardBreak") return "\n"
	const href = node.marks?.find((mark) => mark.type === "link")?.attrs.href
	// Only web addresses are links on the page; anything else keeps just its text.
	if (!isHttpUrl(href)) return node.text
	// Link text holds no brackets or line breaks, and the address no spaces or parentheses. Spaces at
	// the ends of the link's text stay, outside it.
	const [, before = "", text = "", after = ""] =
		/^(\s*)([^]*?)(\s*)$/.exec(node.text.replace(/[[\]\n]/g, "")) ?? []
	const url = markdownUrl(href).replace(/\s/g, encodeURIComponent)
	return `${before}[${text || href}](${url})${after}`
}

/**
 * What the user typed as a link address, as one: `example.com` becomes `https://example.com`.
 * Null when it is not a web address.
 */
export function normalizeHref(input: string): string | null {
	const trimmed = input.trim()
	if (!trimmed) return null
	const href = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
	return isHttpUrl(href) ? href : null
}
