import {
	and,
	type Db,
	db,
	documents,
	eq,
	highlights,
	highlightShares,
	inArray,
	isNotNull,
	isNull,
	sql,
	type Tx,
} from "@klipstack/db"
import { z } from "zod"
import { QUOTE_WORDS_MAX } from "~/lib/editions"

/**
 * What a shared highlight's page shows, copied when it was shared or last updated: nothing on the
 * page reads the library. `note` is the note as written, its links to the reader's library
 * included; `linkUrls` holds those articles' original addresses, which the page links to instead.
 */
const SnapshotV1 = z.object({
	v: z.literal(1),
	exact: z.string(),
	note: z.string().nullable(),
	includeNote: z.boolean(),
	color: z.number().int(),
	article: z.object({
		title: z.string().nullable(),
		url: z.string(),
		siteName: z.string().nullable(),
		/** Absent from links shared before authors were credited. */
		author: z.string().nullable().optional(),
	}),
	linkUrls: z.record(z.string(), z.string()),
	/** The sharer's language when they shared it: the page speaks it, whoever visits. */
	locale: z.string(),
})
export type ShareSnapshot = z.infer<typeof SnapshotV1>

/** A stored snapshot, or null when this code cannot read it. */
export function parseShareSnapshot(value: unknown): ShareSnapshot | null {
	const parsed = SnapshotV1.safeParse(value)
	return parsed.success ? parsed.data : null
}

/** The public page's address. */
export const sharePath = (publicId: string) => `/h/${publicId}`

const PUBLIC_ID = /^[0-9A-Za-z]{12}$/

/** Whether the highlight's quote or note moved on from what the page shows (not its color). */
export function shareChanged(
	snapshot: ShareSnapshot,
	current: { exact: string; note: string | null; author: string | null },
): boolean {
	if (snapshot.exact !== current.exact) return true
	// Links shared before authors were credited have none: updating adds it.
	if ((snapshot.article.author ?? null) !== current.author) return true
	return snapshot.includeNote && (snapshot.note ?? "") !== (current.note?.trim() || "")
}

export interface ShareState {
	publicId: string
	url: string
	includeNote: boolean
	/** The highlight changed since: the page shows the older one until updated. */
	changed: boolean
	/** Taken down by an admin: it cannot be shared again. */
	removed: false
}

/**
 * The highlight's share, for its owner: live, removed by an admin, or null when it is not shared.
 * A deleted highlight, or another reader's, has none.
 */
export async function getShareState(
	userId: string,
	highlightId: string,
	tx: Db | Tx = db,
): Promise<ShareState | { removed: true } | null> {
	const [row] = await tx
		.select({
			publicId: highlightShares.publicId,
			published: highlightShares.published,
			removedAt: highlightShares.removedAt,
			exact: highlights.exact,
			note: highlights.note,
			author: documents.author,
		})
		.from(highlightShares)
		.innerJoin(highlights, eq(highlights.id, highlightShares.highlightId))
		.innerJoin(documents, eq(documents.id, highlights.documentId))
		.where(
			and(
				eq(highlightShares.highlightId, highlightId),
				eq(highlightShares.userId, userId),
				isNull(highlights.deletedAt),
			),
		)
	if (!row) return null
	if (row.removedAt) return { removed: true }
	const snapshot = parseShareSnapshot(row.published)
	if (!snapshot) return null
	return {
		publicId: row.publicId,
		url: sharePath(row.publicId),
		includeNote: snapshot.includeNote,
		changed: shareChanged(snapshot, row),
		removed: false,
	}
}

export type PublicShare =
	| { status: "live"; snapshot: ShareSnapshot; updatedAt: Date }
	| { status: "removed" }
	| { status: "stopped" }

/** The quote's first `max` words, its spacing kept, with "…" where it was cut. */
function clipQuote(text: string, max: number): string {
	let words = 0
	let end = 0
	for (const word of text.matchAll(/\S+/g)) {
		if (words === max) return `${text.slice(0, end)}…`
		words += 1
		end = word.index + word[0].length
	}
	return text
}

/**
 * A shared highlight's page, for anyone: live, taken down by an admin, or stopped (its owner
 * stopped sharing it, or deleted the highlight). Null for an address that never was, or that a
 * new share of the highlight replaced. A live one quotes at most an edition's words: the snapshot
 * keeps the whole highlight, which only its owner sees.
 */
export async function getPublicShare(publicId: string): Promise<PublicShare | null> {
	if (!PUBLIC_ID.test(publicId)) return null
	const [row] = await db
		.select({
			published: highlightShares.published,
			removedAt: highlightShares.removedAt,
			updatedAt: highlightShares.updatedAt,
			deletedAt: highlights.deletedAt,
		})
		.from(highlightShares)
		.innerJoin(highlights, eq(highlights.id, highlightShares.highlightId))
		.where(eq(highlightShares.publicId, publicId))
	if (!row) return null
	if (row.removedAt) return { status: "removed" }
	if (row.published === null || row.deletedAt) return { status: "stopped" }
	const snapshot = parseShareSnapshot(row.published)
	if (!snapshot) throw new Error(`Share ${publicId}: a snapshot this code cannot read`)
	return {
		status: "live",
		snapshot: { ...snapshot, exact: clipQuote(snapshot.exact, QUOTE_WORDS_MAX) },
		updatedAt: row.updatedAt,
	}
}

/** The live shares among these highlights of the user's, for marks in lists. */
export const liveShare = sql`exists (
	select 1 from ${highlightShares} s
	where s.highlight_id = ${highlights.id} and s.published is not null and s.removed_at is null
)`

/** Which of these highlights of the user's are shared at a public link now. */
export async function sharedHighlightIds(userId: string, ids: string[]): Promise<Set<string>> {
	if (ids.length === 0) return new Set()
	const rows = await db
		.select({ id: highlightShares.highlightId })
		.from(highlightShares)
		.where(
			and(
				eq(highlightShares.userId, userId),
				inArray(highlightShares.highlightId, ids),
				isNotNull(highlightShares.published),
				isNull(highlightShares.removedAt),
			),
		)
	return new Set(rows.map((r) => r.id))
}
