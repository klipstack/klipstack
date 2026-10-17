/** What the selection bar offers for the checked articles; safe to import from client code. */
export type BulkAction =
	| "star"
	| "unstar"
	| "shortlist"
	| "unshortlist"
	| "archive"
	| "unarchive"
	| "finish"
	| "unread"
	| "tag"
	| "delete"
	| "restore"
	| "purge"

/** The card fields the choice depends on. */
export interface BulkCard {
	status: string
	deletedAt: Date | null
	starredAt: Date | null
	shortlistedAt: Date | null
	archivedAt: Date | null
	readAt: Date | null
}

export type BulkChoice =
	| { kind: "none" | "mixed"; actions: [] }
	| { kind: "live" | "trash"; actions: BulkAction[] }

/**
 * From the articles, not the view: starred holds library and archive articles alike. A toggle
 * applies its state when any article lacks it, and takes it away when all have it. Trashed and live
 * articles together get nothing; trashed ones can go back or go for good. Failed saves take part in
 * Delete only, as on their cards. Marking for the next edition only with editions on.
 */
export function bulkActions(cards: BulkCard[], { editions = true } = {}): BulkChoice {
	if (cards.length === 0) return { kind: "none", actions: [] }
	const trashed = cards.filter((c) => c.deletedAt)
	if (trashed.length === cards.length) return { kind: "trash", actions: ["restore", "purge"] }
	if (trashed.length > 0) return { kind: "mixed", actions: [] }
	const captured = cards.filter((c) => c.status !== "failed")
	if (captured.length === 0) return { kind: "live", actions: ["delete"] }
	return {
		kind: "live",
		actions: [
			captured.some((c) => !c.starredAt) ? "star" : "unstar",
			...(editions
				? [
						captured.some((c) => !c.shortlistedAt)
							? ("shortlist" as const)
							: ("unshortlist" as const),
					]
				: []),
			captured.some((c) => !c.archivedAt) ? "archive" : "unarchive",
			captured.some((c) => !c.readAt) ? "finish" : "unread",
			"tag",
			"delete",
		],
	}
}

/** Actions after which the articles are somewhere else: they leave the selection. */
export const MOVES: ReadonlySet<BulkAction> = new Set([
	"archive",
	"unarchive",
	"finish",
	"delete",
	"restore",
	"purge",
])

/** Where the selection bar posts; the fetcher key lets the list read what is on its way. */
export const BULK_ACTION = "/documents/bulk"
export const BULK_FETCHER = "bulk-documents"
