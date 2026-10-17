/**
 * The review of old saves (`GET /review`), one article at a time: keep it, archive it or delete
 * it, as on the web's /library/review. A swipe right keeps, a swipe left archives.
 */

export type ReviewAction = "keep" | "archive" | "delete"

/** What `PATCH /articles` changes; Delete goes to the trash instead (`POST /articles/trash`). */
export const REVIEW_CHANGES = {
	keep: { kept: true },
	archive: { location: "archive" },
} as const satisfies Record<Exclude<ReviewAction, "delete">, object>

/** The articles still to decide on, in the review's order: the oldest first. */
export function toDecide<T extends { id: string }>(items: T[], decided: ReadonlySet<string>): T[] {
	return items.filter((a) => !decided.has(a.id))
}

/**
 * Undone: back in the review. Those a reload left out since (it lists only what is still to
 * decide) come first, as they were.
 */
export function putBack<T extends { id: string }>(items: T[], undone: T[]): T[] {
	const shown = new Set(items.map((a) => a.id))
	return [...undone.filter((a) => !shown.has(a.id)), ...items]
}

/** A swipe that ends a third of the card's width away, or flung that way, decides. */
export function swipeDecision(dx: number, vx: number, width: number): ReviewAction | null {
	const flung = Math.abs(vx) > 0.8 && Math.abs(dx) > 40 && Math.sign(vx) === Math.sign(dx)
	if (Math.abs(dx) < width / 3 && !flung) return null
	return dx > 0 ? "keep" : "archive"
}

/** What the toast says once the server answered: "Archived", "12 articles kept". */
export function reviewNotice(action: ReviewAction, count: number): string {
	const done = { keep: "kept", archive: "archived", delete: "deleted" }[action]
	if (count === 1) return done.charAt(0).toUpperCase() + done.slice(1)
	return `${count} articles ${done}`
}

const DAY_MS = 86_400_000

/** "Saved 5 weeks ago", "Saved 3 months ago", "Saved 2 years ago". */
export function savedAgo(savedAt: string, now = new Date()): string {
	const days = Math.max(0, Math.floor((now.getTime() - Date.parse(savedAt)) / DAY_MS))
	if (days >= 730) return `Saved ${Math.floor(days / 365)} years ago`
	if (days >= 365) return "Saved a year ago"
	if (days >= 60) return `Saved ${Math.floor(days / 30)} months ago`
	if (days >= 14) return `Saved ${Math.floor(days / 7)} weeks ago`
	return `Saved ${days} ${days === 1 ? "day" : "days"} ago`
}

/** The server's days as the web says them: "a month", "3 months", "45 days". */
export function spanText(days: number): string {
	if (days % 30 !== 0) return `${days} days`
	return days === 30 ? "a month" : `${days / 30} months`
}

/** How many are left: "12 left"; with more waiting after the page, "25+ left". */
export function leftText(count: number, more: boolean): string {
	return `${count}${more ? "+" : ""} left`
}
