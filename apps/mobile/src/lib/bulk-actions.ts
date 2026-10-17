import type { ArticleSummary } from "@klipstack/sdk"

/** A list of the library: the API's views, each a place in the Library tab; `all`, a topic's. */
export type LibraryView = "inbox" | "starred" | "archive" | "all" | "trash"

/**
 * What the selection bar offers for the checked articles: the web's (`apps/web/app/lib/
 * bulk-actions.ts`). Restore and Delete Forever are for articles in the trash (the Trash, and
 * search's `in:trash`).
 * Tags opens the tag sheet (`useTagSheet`) instead of changing anything itself.
 */
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

type Card = Pick<ArticleSummary, "status" | "starred" | "location" | "finished" | "trashedAt">

export type BulkChoice =
	| { kind: "none" | "mixed"; actions: [] }
	| { kind: "live" | "trash"; actions: BulkAction[] }

/**
 * As the web decides it, from the articles, not the view: starred holds library and archive
 * articles alike. A toggle applies its state when any article lacks it, and takes it away when all
 * have it. Articles in the trash can only be restored or deleted forever, and not together with
 * others (`mixed`).
 * Failed saves take part in Delete only. The mark for the next edition is the long-press menu's
 * only: a seventh button would leave the bar no room for its count on a 375-point phone.
 */
export function bulkActions(cards: Card[]): BulkChoice {
	if (cards.length === 0) return { kind: "none", actions: [] }
	const trashed = cards.filter((c) => c.trashedAt)
	if (trashed.length === cards.length) return { kind: "trash", actions: ["restore", "purge"] }
	if (trashed.length > 0) return { kind: "mixed", actions: [] }
	const captured = cards.filter((c) => c.status !== "failed")
	if (captured.length === 0) return { kind: "live", actions: ["delete"] }
	return {
		kind: "live",
		actions: [
			captured.some((c) => !c.starred) ? "star" : "unstar",
			captured.some((c) => c.location !== "archive") ? "archive" : "unarchive",
			captured.some((c) => !c.finished) ? "finish" : "unread",
			"tag",
			"delete",
		],
	}
}

/**
 * The articles an action changes: all of them for Delete, Restore and Delete Forever, the saved
 * ones otherwise.
 */
export function actedOn<T extends Card>(cards: T[], action: BulkAction): T[] {
	return action === "delete" || action === "restore" || action === "purge"
		? cards
		: cards.filter((c) => c.status !== "failed")
}

/**
 * What `PATCH /articles` changes; Delete goes to the trash instead (`POST /articles/trash`), and
 * Restore takes articles out of it (`POST /articles/restore`).
 */
export const BULK_CHANGES = {
	star: { starred: true },
	unstar: { starred: false },
	shortlist: { shortlisted: true },
	unshortlist: { shortlisted: false },
	archive: { location: "archive" },
	unarchive: { location: "inbox" },
	finish: { finished: true },
	unread: { finished: false },
} as const satisfies Record<Exclude<BulkAction, "tag" | "delete" | "restore" | "purge">, object>

/**
 * An article as the action leaves it, until the server answers: finishing archives it too, and
 * marking it unread starts it over, as on the web.
 */
export function afterAction(
	item: ArticleSummary,
	action: BulkAction,
	now = new Date().toISOString(),
): ArticleSummary {
	switch (action) {
		case "star":
		case "unstar":
			return {
				...item,
				starred: action === "star",
				starredAt: action === "star" ? (item.starredAt ?? now) : null,
			}
		case "shortlist":
		case "unshortlist":
			return { ...item, shortlisted: action === "shortlist" }
		case "archive":
			return { ...item, location: "archive", archivedAt: item.archivedAt ?? now }
		case "unarchive":
			return { ...item, location: "inbox", archivedAt: null }
		case "finish":
			return {
				...item,
				finished: true,
				finishedAt: now,
				progress: 1,
				location: "archive",
				archivedAt: item.archivedAt ?? now,
			}
		case "unread":
			return { ...item, finished: false, finishedAt: null, opened: false, progress: 0 }
		case "tag":
			return item
		case "delete":
			return { ...item, trashedAt: now }
		case "restore":
			return { ...item, trashedAt: null }
		case "purge":
			return item
	}
}

/** Whether a list shows the article. */
export function inView(view: LibraryView, item: ArticleSummary): boolean {
	if (view === "trash") return Boolean(item.trashedAt)
	if (item.trashedAt) return false
	if (view === "all") return true
	return view === "starred" ? item.starred : item.location === view
}

/**
 * Whether a list still shows an article after an action: a view (`view`), only what belongs in
 * it; a search (`query`: a tag, a saved search), what it showed, as the search screen does, but
 * not an article just deleted. The server alone knows whether the query still matches the rest.
 */
export function stillShown(
	list: { view: LibraryView } | { query: string },
	before: ArticleSummary,
	after: ArticleSummary,
): boolean {
	if ("view" in list) return inView(list.view, after)
	return !(after.trashedAt && !before.trashedAt)
}

const DONE: Record<BulkAction, string> = {
	star: "starred",
	unstar: "unstarred",
	shortlist: "added to your next edition",
	unshortlist: "removed from your next edition",
	archive: "archived",
	unarchive: "moved to Inbox",
	finish: "finished",
	unread: "marked as unread",
	tag: "tagged",
	delete: "deleted",
	restore: "restored",
	purge: "deleted forever",
}

/**
 * What the bar says once the server answered, as the web's toast: "3 articles archived".
 * `conflicts`: articles not restored, because the same page was saved again since.
 */
export function bulkNotice(action: BulkAction, count: number, conflicts = 0): string {
	const done = `${count} ${count === 1 ? "article" : "articles"} ${DONE[action]}`
	if (!conflicts) return done
	const kept = `${conflicts} saved again, so still in the trash`
	return count ? `${done} · ${kept}` : kept
}
