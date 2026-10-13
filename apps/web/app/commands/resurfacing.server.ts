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

const DAY_MS = 86_400_000

/**
 * Whether `day` is somebody's today at `now`. Time zones run from 12 hours behind UTC to 14 ahead,
 * so a local date is at most a day from the date in UTC. Picking for any other day would rewrite
 * when highlights were last shown.
 */
const isTodaySomewhere = (day: string, now: Date) =>
	Math.abs(Date.parse(day) - Date.parse(now.toISOString().slice(0, 10))) <= DAY_MS

/**
 * The user's highlights for `day`, their local day (YYYY-MM-DD): picked on the first call for the
 * day and recorded, the same ones after that (less any deleted, dismissed or trashed since). A day
 * that is nobody's today at `now` is refused.
 */
export async function dailyHighlights(
	userId: string,
	day: string,
	now = new Date(),
): Promise<ResurfacedHighlight[]> {
	if (!isDay(day)) throw new AppError("invalid_request", "The day is not a date (YYYY-MM-DD).")
	if (!isTodaySomewhere(day, now))
		throw new AppError("invalid_request", "The day is not today anywhere: send the local date.")
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
