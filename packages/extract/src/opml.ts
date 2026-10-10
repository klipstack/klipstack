import { XMLParser } from "fast-xml-parser"
import { ExtractError } from "./errors"

/** One feed of an OPML file (the format feed readers use to move subscriptions around). */
export interface OpmlFeed {
	/** The feed's address, as written. Not validated. */
	xmlUrl: string
	title: string | null
	htmlUrl: string | null
}

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "",
	isArray: (name) => name.toLowerCase() === "outline",
	htmlEntities: true,
})

type Node = Record<string, unknown>

/** Readers disagree on case (`xmlUrl`, `xmlurl`, `XMLURL`). */
function get(node: Node, name: string): unknown {
	if (name in node) return node[name]
	const lower = name.toLowerCase()
	for (const key of Object.keys(node)) if (key.toLowerCase() === lower) return node[key]
	return undefined
}

function text(value: unknown): string | null {
	if (typeof value !== "string" && typeof value !== "number") return null
	return String(value).replace(/\s+/g, " ").trim() || null
}

/**
 * The feeds of an OPML file, in order: every outline with an `xmlUrl`, whatever its folder.
 * Folders themselves are dropped. Throws `not_opml` when the text is not OPML.
 */
export function parseOpml(input: string): OpmlFeed[] {
	let root: unknown
	try {
		root = get(parser.parse(input) as Node, "opml")
	} catch (cause) {
		throw new ExtractError("not_opml", "Not an OPML file", { cause })
	}
	if (!root || typeof root !== "object") throw new ExtractError("not_opml", "Not an OPML file")

	const found: OpmlFeed[] = []
	// Depth first, in document order: children go on the stack reversed.
	const stack: unknown[] = [get(root as Node, "body")]
	while (stack.length > 0) {
		const node = stack.pop()
		if (Array.isArray(node)) {
			for (let i = node.length - 1; i >= 0; i--) stack.push(node[i])
			continue
		}
		if (!node || typeof node !== "object") continue
		const outline = node as Node
		const xmlUrl = text(get(outline, "xmlUrl"))
		if (xmlUrl)
			found.push({
				xmlUrl,
				title: text(get(outline, "title")) ?? text(get(outline, "text")),
				htmlUrl: text(get(outline, "htmlUrl")),
			})
		stack.push(get(outline, "outline"))
	}
	return found
}

/** An OPML 2.0 file listing `feeds`, flat. */
export function buildOpml(title: string, feeds: OpmlFeed[], now = new Date()): string {
	const outlines = feeds.map((feed) => {
		const name = escapeXml(feed.title ?? feed.xmlUrl)
		const site = feed.htmlUrl ? ` htmlUrl="${escapeXml(feed.htmlUrl)}"` : ""
		return `\t\t<outline type="rss" text="${name}" title="${name}" xmlUrl="${escapeXml(feed.xmlUrl)}"${site}/>`
	})
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<opml version="2.0">',
		"\t<head>",
		`\t\t<title>${escapeXml(title)}</title>`,
		`\t\t<dateCreated>${now.toUTCString()}</dateCreated>`,
		"\t</head>",
		"\t<body>",
		...outlines,
		"\t</body>",
		"</opml>",
		"",
	].join("\n")
}

const XML_ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
}

function escapeXml(value: string): string {
	return (
		value
			// oxlint-disable-next-line no-control-regex -- characters XML 1.0 does not allow
			.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
			.replace(/[&<>"]/g, (char) => XML_ESCAPES[char] ?? char)
	)
}
