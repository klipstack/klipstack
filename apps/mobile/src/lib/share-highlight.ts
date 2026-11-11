import type { HighlightShare } from "@klipstack/api-contract"
import { t } from "./i18n"

/**
 * The Share sheet's pure parts: which way out it opens on, whether the link shows an older
 * highlight, the page's language, and what a refusal says. The web's Share dialog
 * (apps/web/app/components/share-highlight-dialog.tsx), on a phone.
 */

export type ShareTab = "text" | "link" | "image"
export const SHARE_TABS: readonly ShareTab[] = ["text", "link", "image"]
export const TAB_LABELS: Record<ShareTab, string> = {
	text: t("reader.share.tabs.text"),
	link: t("reader.share.tabs.link"),
	image: t("reader.share.tabs.image"),
}

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

/** What the Link tab says when a change was refused, by the error's code. */
export function linkErrorMessage(code: string | null): string {
	if (code === "limit_reached") return t("reader.share.limit")
	if (code === "share_removed") return REMOVED
	return t("reader.share.linkFailed")
}

export const REMOVED = t("reader.share.removed")

/**
 * The highlight's public link, in the Share sheet: `share` undefined while it is looked up, then
 * live, removed or null. `busy` while a change (create, update, stop) runs: one at a time. `changed`
 * once one was made: the lookup's answer, if it comes after, is older.
 */
export type PublicLink = {
	share: HighlightShare | undefined
	busy: boolean
	error: string | null
	changed: boolean
}

export const LINK_LOOKING: PublicLink = {
	share: undefined,
	busy: false,
	error: null,
	changed: false,
}

export type PublicLinkEvent =
	/** The lookup answered: null when it failed (the Link tab offers to create one). */
	| { type: "found"; share: HighlightShare }
	/** A change starts: refused while another runs. */
	| { type: "start" }
	| { type: "done"; share: HighlightShare }
	/** `stop`: the change was to stop sharing. `code`: the API's error code, if any. */
	| { type: "failed"; stop: boolean; code: string | null }

/** The next state. Pure; an event that changes nothing returns the same state. */
export function publicLinkTransition(state: PublicLink, event: PublicLinkEvent): PublicLink {
	switch (event.type) {
		case "found":
			return state.changed ? state : { ...state, share: event.share }
		case "start":
			if (state.busy) return state
			return { ...state, busy: true, error: null, changed: true }
		case "done":
			return { ...state, busy: false, share: event.share }
		case "failed":
			// Stopped elsewhere already (the web, another phone): it is not shared, as asked.
			if (event.stop && event.code === "not_found") return { ...state, busy: false, share: null }
			return {
				...state,
				busy: false,
				share: event.code === "share_removed" ? { removed: true } : state.share,
				error: event.code ?? "failed",
			}
	}
}
