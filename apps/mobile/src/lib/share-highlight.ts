import type { HighlightShare } from "@klipstack/api-contract"

/**
 * The Share sheet's pure parts: which way out it opens on, whether the link shows an older
 * highlight, the page's language, and what a refusal says. The web's Share dialog
 * (apps/web/app/components/share-highlight-dialog.tsx), on a phone.
 */

export type ShareTab = "text" | "link" | "image"
export const SHARE_TABS: readonly ShareTab[] = ["text", "link", "image"]
export const TAB_LABELS: Record<ShareTab, string> = { text: "Text", link: "Link", image: "Image" }

/** A tab saved on the device, or text for anything else (none yet, an older file). */
export function parseShareTab(raw: string | null): ShareTab {
	try {
		const saved: unknown = raw ? JSON.parse(raw) : null
		return saved === "link" || saved === "image" ? saved : "text"
	} catch {
		return "text"
	}
}

/**
 * The tab the sheet shows: Link while the highlight has a live link and the reader chose no other;
 * else the one chosen last on this device.
 */
export function shownTab(share: HighlightShare | undefined, last: ShareTab, chosen: boolean) {
	if (!chosen && share && !share.removed) return "link"
	return last
}

/** The link's page shows an older highlight, or another note choice, than the sheet does now. */
export function linkStale(share: HighlightShare | undefined, withNote: boolean): boolean {
	if (!share || share.removed) return false
	return share.changed || share.includeNote !== withNote
}

/** The page's language: Spanish on a phone set to Spanish, else English. */
export function shareLocale(deviceLocale: string): "en" | "es" {
	return deviceLocale.toLowerCase().startsWith("es") ? "es" : "en"
}

/** What the Link tab says when a change was refused, by the error's code. */
export function linkErrorMessage(code: string | null): string {
	if (code === "limit_reached") return "You shared as many highlights as you can this month."
	if (code === "share_removed") return REMOVED
	return "The link didn't change. Try again."
}

export const REMOVED = "This highlight was taken down after a report, and can't be shared."
