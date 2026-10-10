/**
 * Helpers of the search page that the phone top bar shares; safe to import from client code. Which
 * queries can be saved, and under what name, is the contract's (`canSaveSearch`,
 * `defaultSavedSearchName`): the app saves searches too.
 */

export function searchPath(q: string): string {
	return q ? `/search?q=${encodeURIComponent(q)}` : "/search"
}

/** The search a tag opens: its chip, its sidebar row, its row in the command menu. */
export function tagSearchPath(name: string): string {
	return searchPath(`tag:${/\s/.test(name) ? `"${name}"` : name}`)
}

/** Where the search page was opened from (a view's search button says), else the inbox. */
export function searchOrigin(state: unknown): string {
	const from = (state as { from?: unknown } | null)?.from
	return typeof from === "string" && from.startsWith("/") && !from.startsWith("//")
		? from
		: "/library"
}

/** No query yet, or one a view's button left open ("in:archive "): the field takes the keyboard. */
export function awaitsWords(q: string): boolean {
	return q.trim() === "" || /\s$/.test(q)
}
