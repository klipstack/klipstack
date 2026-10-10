/**
 * The library's lists as a grid of cards or as a list of rows, as the web's layout toggle. The
 * choice is the device's, for every list (`list-layout.json` in the app's documents). Pure:
 * storage is in `reader-files.ts`.
 */
export type ListLayout = "grid" | "list"

/** Stored JSON to a layout; anything unknown is the grid, the web's layout on a phone. */
export function parseListLayout(raw: string | null | undefined): ListLayout {
	try {
		return JSON.parse(raw ?? "") === "list" ? "list" : "grid"
	} catch {
		return "grid"
	}
}
