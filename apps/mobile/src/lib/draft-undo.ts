import type { ArticleSummary, KlipstackClient } from "@klipstack/sdk"
import { dismissToast, showToast, track } from "./article-changes"

/** The toast offering to undo an unmark, and the articles it would mark again. */
let offered: { toast: number; ids: Set<string> } | null = null

/**
 * After marking or unmarking (`changes.shortlisted`; anything else is left alone). Unmarking that
 * took articles out of the draft edition in progress lost their copy there (the note, the chosen
 * highlights): a toast's Undo puts it back as it was, with the mark. The web's toast
 * (`apps/web/app/hooks/use-draft-undo-toast.ts`). Nothing when no draft lost them. Marking one of
 * them again takes the toast away: the draft has a fresh copy, and the undo would restore nothing.
 * `undone`, with the articles as the undo left them; lists load again either way (`track`). One
 * request's answer: the app unmarks one article at a time.
 */
export function afterMarking(
	client: Pick<KlipstackClient, "articles">,
	changes: { readonly [change: string]: unknown },
	answer: { items: ArticleSummary[]; undo?: string[]; removedFromDraft?: string[] },
	undone?: (items: ArticleSummary[]) => void,
): void {
	if (changes.shortlisted === true) {
		if (offered && answer.items.some((a) => offered?.ids.has(a.id))) dismissToast(offered.toast)
		return
	}
	const token = answer.undo?.[0]
	if (changes.shortlisted !== false || !token || !answer.removedFromDraft?.length) return
	const toast = showToast({
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
	offered = { toast, ids: new Set(answer.removedFromDraft) }
}

/** The reader's article as an undo left it: marked again. Unchanged when the undo was another's. */
export function withUndone<T extends Pick<ArticleSummary, "id" | "shortlisted">>(
	article: T | null,
	items: Pick<ArticleSummary, "id" | "shortlisted">[],
): T | null {
	const back = article && items.find((a) => a.id === article.id)
	return article && back ? { ...article, shortlisted: back.shortlisted } : article
}
