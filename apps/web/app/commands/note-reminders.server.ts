import { Id } from "@klipstack/api-contract"
import { db } from "@klipstack/db"
import { notFound, parseInput } from "~/lib/app-error"
import { setNoteSkipped, snoozeNoteReminders } from "~/services/note-reminders.server"
import { NO_ARTICLE } from "./articles.server"

/**
 * Home's gentle question about articles finished without a note (`~/services/note-reminders`):
 * "Nothing to add" on one, which it never asks about again (and taking that back), and "Not now"
 * on the card. An article in the trash, or not the user's, is `not_found`.
 */

export async function skipArticleNote(userId: string, id: string, skipped = true): Promise<void> {
	const articleId = parseInput(Id, id)
	if (!(await setNoteSkipped(db, userId, articleId, skipped))) throw notFound(NO_ARTICLE)
}

/** "Not now" on Home's card: no card for a week (`NOTE_REMINDERS.snoozeDays`). */
export function snoozeNoteReminderCard(userId: string): Promise<void> {
	return snoozeNoteReminders(userId)
}
