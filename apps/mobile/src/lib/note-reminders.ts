/** Home's question about notes: the pure parts. The card is `src/components/note-reminders.tsx`. */

const DAY_MS = 86_400_000

/** "Listened to today", "Finished yesterday", "Finished 3 days ago": by calendar days, here. */
export function finishedLabel(
	item: { finishedAt: string; listened: boolean },
	now = new Date(),
): string {
	const verb = item.listened ? "Listened to" : "Finished"
	const day = (date: Date) =>
		new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
	const days = Math.round((day(now) - day(new Date(item.finishedAt))) / DAY_MS)
	if (days <= 0) return `${verb} today`
	if (days === 1) return `${verb} yesterday`
	return `${verb} ${days} days ago`
}
