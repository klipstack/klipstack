/**
 * Canonical text of a DOM subtree: the concatenation of every Text node's data in document
 * order. This is the coordinate space for highlight offsets. It must produce identical output
 * for the same HTML in the browser (after `innerHTML`) and in jsdom, so it deliberately does no
 * whitespace normalization and no block separators.
 */
export function canonicalText(root: Node): string {
	const parts: string[] = []
	walkTextNodes(root, (node) => {
		parts.push(node.data)
	})
	return parts.join("")
}

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"])

/** Visit Text nodes in document order, skipping script/style-like subtrees. */
export function walkTextNodes(root: Node, visit: (node: Text) => void): void {
	const stack: Node[] = [root]
	while (stack.length) {
		const node = stack.pop() as Node
		if (node.nodeType === 3) {
			visit(node as Text)
			continue
		}
		if (node.nodeType === 1 && SKIP_TAGS.has((node as Element).tagName)) continue
		const children = node.childNodes
		for (let i = children.length - 1; i >= 0; i--) stack.push(children[i] as Node)
	}
}

const BLOCK_TAGS = new Set([
	"P",
	"DIV",
	"SECTION",
	"ARTICLE",
	"ASIDE",
	"HEADER",
	"FOOTER",
	"MAIN",
	"NAV",
	"H1",
	"H2",
	"H3",
	"H4",
	"H5",
	"H6",
	"UL",
	"OL",
	"LI",
	"DL",
	"DT",
	"DD",
	"BLOCKQUOTE",
	"PRE",
	"TABLE",
	"THEAD",
	"TBODY",
	"TFOOT",
	"TR",
	"TD",
	"TH",
	"CAPTION",
	"FIGURE",
	"FIGCAPTION",
	"HR",
	"BR",
	"DETAILS",
	"SUMMARY",
	"ADDRESS",
])

/**
 * Human-readable plain text: block elements separated by newlines, whitespace collapsed.
 * For search indexing, word counts, snippets, and exports. NOT for offsets.
 */
export function plainText(root: Node): string {
	const out: string[] = []
	const visit = (node: Node) => {
		if (node.nodeType === 3) {
			out.push((node as Text).data.replace(/[\s\u00a0]+/g, " "))
			return
		}
		if (node.nodeType !== 1) return
		const el = node as Element
		if (SKIP_TAGS.has(el.tagName)) return
		if (el.tagName === "PRE") {
			out.push("\n", el.textContent ?? "", "\n")
			return
		}
		const block = BLOCK_TAGS.has(el.tagName)
		if (block) out.push("\n")
		for (const child of Array.from(el.childNodes)) visit(child)
		if (block) out.push("\n")
	}
	visit(root)
	return out
		.join("")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/ {2,}/g, " ")
		.trim()
}

export function countWords(text: string): number {
	const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)
	return m ? m.length : 0
}
