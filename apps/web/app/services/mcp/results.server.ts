import type { CallToolResult } from "@modelcontextprotocol/server"
import { z } from "zod"
import { appOrigin, articleSummary as summary } from "../article-summary.server"
import type { LibraryCard } from "../documents.server"
import { uuid } from "./ids"

/** Shapes the MCP tools return: article summaries, JSON and error results, cursors. */

export { appOrigin, readerUrl } from "../article-summary.server"

/** How notes link to other articles, for tool descriptions. */
export const NOTE_LINKS_HINT = `To link another article in the library, use [Title](/read/<article id>) or the absolute Klipstack URL [Title](${appOrigin}/read/<article id>). Use the article's lowercase id. Both formats create the same connection and backlinks. Notes are stored and returned in JSON with relative links; get_article displays absolute links.`

/** The shared summary as tools show it: `klipstackUrl`, and a status only while not ready. */
export function articleSummary(card: LibraryCard) {
	const {
		id,
		title,
		author,
		site,
		description,
		url,
		readerUrl,
		status,
		failure: _failure,
		trashedAt: _trashedAt,
		// Assistants read text; the picture would only cost tokens.
		leadImage: _leadImage,
		...rest
	} = summary(card)
	return {
		id,
		title,
		author,
		site,
		description,
		url,
		klipstackUrl: readerUrl,
		...rest,
		...(status === "ready" ? {} : { status }),
	}
}

export function json(value: unknown): CallToolResult {
	return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] }
}

export function toolError(text: string): CallToolResult {
	return { isError: true, content: [{ type: "text", text }] }
}

const highlightCursor = z.object({ createdAt: z.iso.datetime({ offset: true }), id: uuid() })

export function encodeHighlightCursor(c: z.infer<typeof highlightCursor>) {
	return Buffer.from(JSON.stringify(c)).toString("base64url")
}

export function decodeHighlightCursor(value: string | undefined) {
	if (!value) return null
	try {
		return highlightCursor.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")))
	} catch {
		return null
	}
}

const articleNoteCursor = z.object({ updatedAt: z.iso.datetime({ offset: true }), id: uuid() })

export function encodeArticleNoteCursor(c: z.infer<typeof articleNoteCursor>) {
	return Buffer.from(JSON.stringify(c)).toString("base64url")
}

export function decodeArticleNoteCursor(value: string | undefined) {
	if (!value) return null
	try {
		return articleNoteCursor.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")))
	} catch {
		return null
	}
}
