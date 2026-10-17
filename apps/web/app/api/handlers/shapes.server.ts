import { HIGHLIGHT_COLORS, type Highlight } from "@klipstack/api-contract"
import type { Document } from "@klipstack/db"

/** Response shapes built from rows, shared by handlers. */

export type HighlightArticle = Highlight["article"]

export function articleRef(doc: Pick<Document, "id" | "title" | "siteName" | "sourceUrl">) {
	return { id: doc.id, title: doc.title, site: doc.siteName, url: doc.sourceUrl }
}

export function highlightShape(
	h: {
		id: string
		exact: string
		prefix: string
		suffix: string
		startOffset: number
		endOffset: number
		note: string | null
		color: number
		createdAt: Date
		/** Shared at a public link now. */
		shared: boolean
	},
	article: HighlightArticle,
): Highlight {
	return {
		id: h.id,
		quote: h.exact,
		note: h.note,
		color: HIGHLIGHT_COLORS[h.color] ?? "yellow",
		createdAt: h.createdAt.toISOString(),
		article,
		prefix: h.prefix,
		suffix: h.suffix,
		start: h.startOffset,
		end: h.endOffset,
		shared: h.shared,
	}
}
