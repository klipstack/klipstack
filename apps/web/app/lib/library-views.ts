/** Library views map to paths; safe to import from client code. */
export type LibraryView = "inbox" | "archive" | "starred" | "trash"

/** /library → inbox, /archive → archive, /starred → starred, /trash → trash. */
export function viewFromPath(pathname: string): LibraryView {
	if (pathname.startsWith("/archive")) return "archive"
	if (pathname.startsWith("/starred")) return "starred"
	if (pathname.startsWith("/trash")) return "trash"
	return "inbox"
}

export const LIBRARY_VIEWS = [
	"inbox",
	"archive",
	"starred",
	"trash",
] as const satisfies LibraryView[]

/** One of the library's views, the tabs of its page (not the review, which has a page of its own). */
export function isLibraryPath(pathname: string): boolean {
	const path = pathname.replace(/\/$/, "")
	return LIBRARY_VIEWS.some((v) => viewPath(v) === path)
}

export function viewPath(view: LibraryView): string {
	return view === "inbox" ? "/library" : `/${view}`
}

/** The search operator that looks where a view looks. */
const VIEW_OPERATOR: Record<LibraryView, string> = {
	inbox: "in:library",
	archive: "in:archive",
	starred: "is:starred",
	trash: "in:trash",
}

/** The search page, looking where the view looks. The space after the operator awaits the words. */
export function viewSearchPath(view: LibraryView): string {
	return `/search?q=${encodeURIComponent(`${VIEW_OPERATOR[view]} `)}`
}
