import { isCursorTime, isUuid } from "~/lib/page-cursor"
import { type Cursor, decodeCursor } from "~/services/documents.server"
import { ApiError } from "./errors.server"

/**
 * Page cursors are opaque to clients: base64url JSON the server wrote. A cursor that does not
 * decode, or holds values the queries would choke on, is a 400.
 */

export const invalidCursor = () =>
	ApiError.of("invalid_request", "Invalid cursor. Pass a nextCursor from the same list.", {
		details: { where: "query", issues: [{ path: ["cursor"], message: "Invalid cursor" }] },
	})

export function articleCursor(value: string | undefined): Cursor | null {
	if (!value) return null
	const cursor = decodeCursor(value)
	if (!cursor) throw invalidCursor()
	return cursor
}

export interface HighlightCursor {
	createdAt: string
	id: string
}

export function encodeHighlightCursor(cursor: HighlightCursor): string {
	return Buffer.from(JSON.stringify(cursor)).toString("base64url")
}

export function highlightCursor(value: string | undefined): HighlightCursor | null {
	if (!value) return null
	try {
		const c = JSON.parse(
			Buffer.from(value, "base64url").toString("utf8"),
		) as Partial<HighlightCursor>
		if (typeof c.createdAt === "string" && isCursorTime(c.createdAt) && typeof c.id === "string")
			if (isUuid(c.id)) return { createdAt: c.createdAt, id: c.id }
	} catch {
		// fall through
	}
	throw invalidCursor()
}

/** Where one feed's posts continue (`GET /feed`): the feed, and the last post returned. */
export interface FeedCursor {
	feed: string
	sortKey: string
	id: string
}

export function encodeFeedCursor(cursor: FeedCursor): string {
	return Buffer.from(JSON.stringify(cursor)).toString("base64url")
}

export function feedCursor(value: string | undefined): FeedCursor | null {
	if (!value) return null
	try {
		const c = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<FeedCursor>
		if (
			typeof c.feed === "string" &&
			isUuid(c.feed) &&
			typeof c.sortKey === "string" &&
			isCursorTime(c.sortKey) &&
			typeof c.id === "string" &&
			isUuid(c.id)
		)
			return { feed: c.feed.toLowerCase(), sortKey: c.sortKey, id: c.id }
	} catch {
		// fall through
	}
	throw invalidCursor()
}

/** Where a Notebook page continues (By article, Stream): the last time and id returned. */
export interface NotebookCursor {
	at: string
	id: string
}

export function encodeNotebookCursor(cursor: NotebookCursor): string {
	return Buffer.from(JSON.stringify(cursor)).toString("base64url")
}

export function notebookCursor(value: string | undefined): NotebookCursor | null {
	if (!value) return null
	try {
		const c = JSON.parse(
			Buffer.from(value, "base64url").toString("utf8"),
		) as Partial<NotebookCursor>
		if (typeof c.at === "string" && isCursorTime(c.at) && typeof c.id === "string" && isUuid(c.id))
			return { at: c.at, id: c.id }
	} catch {
		// fall through
	}
	throw invalidCursor()
}
