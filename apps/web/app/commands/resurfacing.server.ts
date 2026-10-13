import { Id } from "@klipstack/api-contract"
import { db } from "@klipstack/db"
import { AppError, notFound, parseInput } from "~/lib/app-error"
import {
	isDay,
	listDay,
	pickDay,
	type ResurfacedHighlight,
	setResurfacingDismissed,
} from "~/services/resurfacing.server"

/**
 * Highlights brought back to the reader (`~/services/resurfacing.server`): the day's few, and "Not
 * useful anymore", which stops one coming back; the highlight and its note stay. A deleted
 * highlight, or one whose article is in the trash, is `not_found`.
 */

const NO_HIGHLIGHT = "No highlight with that id."

/**
 * The user's highlights for `day`, their local day (YYYY-MM-DD): picked on the first call for the
 * day and recorded, the same ones after that (less any deleted, dismissed or trashed since).
 */
export async function dailyHighlights(userId: string, day: string): Promise<ResurfacedHighlight[]> {
	if (!isDay(day)) throw new AppError("invalid_request", "The day is not a date (YYYY-MM-DD).")
	return db.transaction(async (tx) => {
		await pickDay(tx, userId, day)
		return listDay(userId, day, tx)
	})
}

async function setDismissed(userId: string, id: string, at: Date | null) {
	if (!(await setResurfacingDismissed(db, userId, parseInput(Id, id), at)))
		throw notFound(NO_HIGHLIGHT)
}

/** "Not useful anymore": the highlight is never picked again. `resumeResurfacing` undoes it. */
export async function stopResurfacing(userId: string, id: string): Promise<void> {
	await setDismissed(userId, id, new Date())
}

/** Undo of `stopResurfacing`: the highlight may come back, and shows again today if picked today. */
export async function resumeResurfacing(userId: string, id: string): Promise<void> {
	await setDismissed(userId, id, null)
}
