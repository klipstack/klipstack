import { Id } from "@klipstack/api-contract"
import { db } from "@klipstack/db"
import { notFound, parseInput } from "~/lib/app-error"
import { getHighlightWithArticle } from "~/services/highlights.server"
import { setResurfacingDismissed } from "~/services/resurfacing.server"

/**
 * Highlights brought back on Home (`~/services/resurfacing.server`). "Not useful anymore" stops one
 * from coming back; the highlight and its note stay. A deleted highlight, or one whose article is in
 * the trash, is `not_found`.
 */

const NO_HIGHLIGHT = "No highlight with that id."

async function owned(userId: string, id: string): Promise<string> {
	const highlightId = parseInput(Id, id)
	if (!(await getHighlightWithArticle(userId, highlightId))) throw notFound(NO_HIGHLIGHT)
	return highlightId
}

/** "Not useful anymore": the highlight is never picked again. `resumeResurfacing` undoes it. */
export async function stopResurfacing(userId: string, id: string): Promise<void> {
	await setResurfacingDismissed(db, userId, await owned(userId, id), new Date())
}

/** Undo of `stopResurfacing`: the highlight may come back, and shows again today if picked today. */
export async function resumeResurfacing(userId: string, id: string): Promise<void> {
	await setResurfacingDismissed(db, userId, await owned(userId, id), null)
}
