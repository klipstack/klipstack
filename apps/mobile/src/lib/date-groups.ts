/**
 * Archive and Starred in sections by how long ago articles got there, as the web's
 * (`apps/web/app/lib/date-groups.ts`): Today, Yesterday, Last 7 days, Earlier this month, then each
 * earlier month of this year by name, and each year before. Days are the phone's own, in its time
 * zone.
 */

import { dateLocale, t } from "./i18n"

/** "today", "yesterday", "week", "month", "month:YYYY-MM" or "year:YYYY". */
export type DateGroup = string

const DAY_MS = 86_400_000

const calendarDay = (date: Date) => ({
	year: date.getFullYear(),
	month: date.getMonth() + 1,
	index: Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
})

export function dateGroup(date: Date, now: Date): DateGroup {
	const a = calendarDay(date)
	const b = calendarDay(now)
	const days = Math.round((b.index - a.index) / DAY_MS)
	if (days <= 0) return "today"
	if (days === 1) return "yesterday"
	if (days < 7) return "week"
	if (a.year === b.year && a.month === b.month) return "month"
	if (a.year === b.year) return `month:${a.year}-${String(a.month).padStart(2, "0")}`
	return `year:${a.year}`
}

const NAMED: Record<string, string> = {
	today: t("library.dateGroups.today"),
	yesterday: t("library.dateGroups.yesterday"),
	week: t("library.dateGroups.week"),
	month: t("library.dateGroups.month"),
}

/** A month's name in the app's language, capitalized as a heading: "September", "Septiembre". */
function monthName(month: number): string {
	const name = new Intl.DateTimeFormat(dateLocale, { month: "long", timeZone: "UTC" }).format(
		new Date(Date.UTC(2000, month - 1, 15)),
	)
	return name.charAt(0).toLocaleUpperCase(dateLocale) + name.slice(1)
}

export function dateGroupLabel(group: DateGroup): string {
	if (group.startsWith("month:")) {
		const month = Number(group.slice(11))
		return month >= 1 && month <= 12 ? monthName(month) : group
	}
	if (group.startsWith("year:")) return group.slice(5)
	return NAMED[group] ?? group
}

/**
 * The list in sections, in the order given (newest first): a heading where the group changes.
 * `at` is when an article got into the list; one without (an action took it away meanwhile) joins
 * the section before it.
 */
export function inSections<T>(
	items: T[],
	at: (item: T) => string | null | undefined,
	now: Date,
): { title: string; items: T[] }[] {
	const sections: { group: DateGroup; title: string; items: T[] }[] = []
	for (const item of items) {
		const when = at(item)
		const last = sections.at(-1)
		const group = when ? dateGroup(new Date(when), now) : (last?.group ?? "today")
		if (last && last.group === group) last.items.push(item)
		else sections.push({ group, title: dateGroupLabel(group), items: [item] })
	}
	return sections.map(({ title, items }) => ({ title, items }))
}
