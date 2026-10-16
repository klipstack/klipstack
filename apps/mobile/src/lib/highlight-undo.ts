import type { Highlight, KlipstackClient } from "@klipstack/sdk"
import { dismissToast, showToast, TOAST_MS } from "./article-changes"

/** A note took writing: its toast stays longer, as on the web (`LONG_UNDO_MS`). */
export const NOTE_UNDO_MS = 15_000

/**
 * After deleting a highlight (`deleting`, the request on its way): a toast with Undo, as on the
 * web. Undo waits for the delete to land, then brings the highlight back with its note and hands
 * it to `restored`. A delete that fails takes the toast away: the screen put the highlight back.
 */
export function offerHighlightUndo(
	client: Pick<KlipstackClient, "highlights">,
	highlight: { id: string; note: string | null },
	deleting: Promise<unknown>,
	restored: (highlight: Highlight) => void,
): void {
	const toast = showToast(
		{
			message: highlight.note ? "Highlight and its note deleted" : "Highlight deleted",
			action: {
				label: "Undo",
				run: () => {
					deleting.then(
						() =>
							client.highlights.restore(highlight.id).then(
								(answer) => restored(answer.highlight),
								() => showToast({ message: "Couldn't bring the highlight back." }),
							),
						() => undefined,
					)
				},
			},
		},
		highlight.note ? NOTE_UNDO_MS : TOAST_MS,
	)
	deleting.catch(() => dismissToast(toast))
}
