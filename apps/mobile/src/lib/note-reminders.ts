import { t } from "./i18n"

/** Home's question about notes: the pure parts. The card is `src/components/note-reminders.tsx`. */

const DAY_MS = 86_400_000

/** "Listened to today", "Finished yesterday", "Finished 3 days ago": by calendar days, here. */
export function finishedLabel(
	item: { finishedAt: string; listened: boolean },
	now = new Date(),
): string {
	const verb = item.listened ? "listened" : "finished"
	const day = (date: Date) =>
		new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
	const days = Math.round((day(now) - day(new Date(item.finishedAt))) / DAY_MS)
	if (days <= 0) return t(`home.notes.${verb}.today`)
	if (days === 1) return t(`home.notes.${verb}.yesterday`)
	return t(`home.notes.${verb}.days`, { count: days })
}
