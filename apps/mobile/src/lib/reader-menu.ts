import type { ArticleSummary } from "@klipstack/sdk"

/** What the reader's ⋯ menu can do to its article, beyond the page's own (Contents, Share…). */
export type ReaderAction =
	| "restore"
	| "retry"
	| "star"
	| "archive"
	| "finish"
	| "unread"
	| "shortlist"
	| "tags"
	| "rename"
	| "delete"
	| "purge"

/**
 * Which the reader's ⋯ offers, as the long-press menu of the article's card does: in the trash,
 * Restore and Delete Forever only; a failed save, Try Again and Delete; a save under way, what
 * needs no text. Finishing and marking unread wait for the article to be ready.
 */
export function readerActions(
	article: Pick<ArticleSummary, "status" | "trashedAt" | "finished">,
): Set<ReaderAction> {
	if (article.trashedAt) return new Set(["restore", "purge"])
	if (article.status === "failed") return new Set(["retry", "delete"])
	const actions = new Set<ReaderAction>([
		"star",
		"archive",
		"shortlist",
		"tags",
		"rename",
		"delete",
	])
	if (article.status === "ready") {
		actions.add("unread")
		if (!article.finished) actions.add("finish")
	}
	return actions
}
