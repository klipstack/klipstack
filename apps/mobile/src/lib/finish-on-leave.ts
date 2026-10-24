import type { KlipstackClient } from "@klipstack/sdk"
import { showToast, track } from "./article-changes"
import { t } from "./i18n"

/**
 * Finishes an article as the reader closes, then says so in a toast with an undo. Lists wait for it
 * (`track`). A failure leaves the article as it was, quietly: the reader is gone, and nothing was
 * lost.
 */
export function finishOnLeave(
	client: Pick<KlipstackClient, "articles">,
	id: string,
	archived: boolean,
): Promise<void> {
	return track(
		client.articles
			.update([id], { finished: true })
			.then((result) => showFinished(client, result.undo, archived)),
	).catch(() => {})
}

/** "Finished and Archived", with the undo `PATCH /articles` gave; nothing when nothing changed. */
export function showFinished(
	client: Pick<KlipstackClient, "articles">,
	undo: string[] | undefined,
	archived: boolean,
): void {
	const token = undo?.[0]
	if (!token) return
	showToast({
		message: archived ? t("library.finished.marked") : t("library.finished.archived"),
		action: {
			label: t("common.actions.undo"),
			run: () => {
				track(client.articles.undo(token)).catch(() =>
					showToast({ message: t("library.finished.undoFailed") }),
				)
			},
		},
	})
}
