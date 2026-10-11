import type { ArticleSummary, KlipstackClient } from "@klipstack/sdk"
import { showToast, track } from "./article-changes"

/**
 * After unmarking: when it took the article out of the draft edition in progress, its copy there
 * (the note, the chosen highlights) is gone, and the toast's Undo puts it back as it was, with the
 * mark. The web's toast (`apps/web/app/hooks/use-draft-undo-toast.ts`). Nothing when no draft lost
 * it. `undone`, with the articles as the undo left them; lists load again either way (`track`).
 */
export function showUnmarked(
	client: Pick<KlipstackClient, "articles">,
	answer: { undo?: string[]; removedFromDraft?: string[] },
	undone?: (items: ArticleSummary[]) => void,
): void {
	const token = answer.undo?.[0]
	if (!token || !answer.removedFromDraft?.length) return
	showToast({
		message: "Removed from your next edition",
		action: {
			label: "Undo",
			run: () => {
				track(client.articles.undo(token)).then(
					(result) => undone?.(result.items),
					() => showToast({ message: "Couldn't put it back in your next edition." }),
				)
			},
		},
	})
}
