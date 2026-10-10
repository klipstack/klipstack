/** The clipboard, looked at without reading it (`modules/klip-pasteboard`). */
export type ClipboardNow = {
	/** Goes up each time anything is copied: the same number, the same contents. */
	count: number
	/** Whether it holds a link (a URL item). */
	hasLink: boolean
}

/**
 * Which copy Home's card offers after a look at the clipboard, by its change count, or null:
 * the copy it offers while that is still there; else a new copy with a link, not offered before
 * (`seen`, the last one offered, saved or copied by the app). A copy without a link, or gone,
 * takes the card away.
 */
export function nextOffer(
	offered: number | null,
	now: ClipboardNow,
	seen: number | null,
): number | null {
	if (!now.hasLink) return null
	if (now.count === offered) return offered
	return now.count === seen ? null : now.count
}
