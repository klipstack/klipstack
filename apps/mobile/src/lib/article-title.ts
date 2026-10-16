import { ARTICLE_TITLE_MAX } from "@klipstack/api-contract/names"

/**
 * The title a rename sends, from what was typed: trimmed and, like the web's field, no longer than
 * `ARTICLE_TITLE_MAX`. Null when it is empty or the title as it is: nothing to send.
 */
export function newTitle(typed: string | undefined, current: string | null): string | null {
	const title = (typed ?? "").trim().slice(0, ARTICLE_TITLE_MAX).trim()
	return title && title !== current ? title : null
}
