import type { Toast } from "./toast"
import { refusal } from "./web-result"

/**
 * Restoring an article from the trash fails when the same page was saved again meanwhile: the
 * library keeps one live article per URL. The state action refuses with `already_saved` (409) and
 * the live article's id; whoever submitted the restore says so, and offers it. Safe to import from
 * client code.
 */
export interface AlreadySaved {
	/** The article in the library with the same URL. */
	articleId: string
}

export function alreadySaved(data: unknown): AlreadySaved | null {
	const error = refusal(data)
	if (error?.code !== "already_saved") return null
	const articleId = error.details?.articleId
	return typeof articleId === "string" ? { articleId } : null
}

export function alreadySavedToast(
	conflict: AlreadySaved,
	text: { message: string; open: string },
): Omit<Toast, "id"> {
	return {
		warn: true,
		message: text.message,
		link: { label: text.open, to: `/read/${conflict.articleId}` },
	}
}
