import { longerThan } from "@klipstack/api-contract/reading"
import type { ReadingStats } from "@klipstack/sdk"
import { dateLocale, t } from "./i18n"

/**
 * The Your Reading screen's words and shapes, as the web's /reading page says and draws them
 * (apps/web/app/routes/reading.tsx). Every day is `YYYY-MM-DD` in the reader's time zone, which
 * the server already applied: here a day has no zone, so it is read and named as UTC.
 */

type ReadTotals = ReadingStats["totals"]["week"]

const asDate = (day: string) => new Date(`${day}T00:00:00Z`)
const nextDay = (day: string) =>
	new Date(asDate(day).getTime() + 86_400_000).toISOString().slice(0, 10)
/** Monday 0 to Sunday 6. */
const weekday = (day: string) => (asDate(day).getUTCDay() + 6) % 7

/** The year grid's columns, a week each from Monday, from `from` (a Monday) to today. */
export function yearWeeks(from: string, today: string): string[][] {
	const weeks: string[][] = []
	for (let day = from; day <= today; day = nextDay(day)) {
		if (weekday(day) === 0 || weeks.length === 0) weeks.push([])
		weeks.at(-1)!.push(day)
	}
	return weeks
}

/** How much ink a day gets: none, one article, two or three, more. */
export function heatLevel(count: number): 0 | 1 | 2 | 3 {
	return count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : 3
}

const DAY_FORMATS = {
	short: { month: "short", day: "numeric" },
	long: { month: "long", day: "numeric", year: "numeric" },
	month: { month: "long" },
	monthShort: { month: "short" },
	monthYear: { month: "long", year: "numeric" },
} satisfies Record<string, Intl.DateTimeFormatOptions>

/** A day in the phone's language: "March 1, 2026", "Mar 1", "March", "Mar", "March 2026". */
export function dayName(day: string, format: keyof typeof DAY_FORMATS): string {
	return new Intl.DateTimeFormat(dateLocale, { ...DAY_FORMATS[format], timeZone: "UTC" }).format(
		asDate(day),
	)
}

const number = (n: number) => new Intl.NumberFormat(dateLocale).format(n)

export const amounts = {
	articles: (count: number) => t("library.reading.articles", { count, n: number(count) }),
	words: (count: number) => t("library.reading.words", { count, n: number(count) }),
	/** Estimated from the articles' length: "about". */
	minutes: (count: number) =>
		count < 60
			? t("library.reading.minutes", { count })
			: count % 60
				? t("library.reading.hours", { hours: Math.floor(count / 60), minutes: count % 60 })
				: t("library.reading.wholeHours", { hours: count / 60 }),
}

/** One of the totals, as its row says it: the length only once something was read. */
export function total(totals: ReadTotals): {
	articles: string
	length: string | null
	book: string | null
} {
	const book = longerThan(totals.words)
	return {
		articles: amounts.articles(totals.articles),
		length: !totals.articles
			? null
			: totals.minutes
				? t("library.reading.length", {
						words: amounts.words(totals.words),
						minutes: amounts.minutes(totals.minutes),
					})
				: amounts.words(totals.words),
		book: book
			? t("library.reading.longerThan", { book: t(`library.reading.books.${book}`) })
			: null,
	}
}

/**
 * A bar's label, under it: a week by its Monday's day, with the month under the first week of
 * one (narrow bars fit no more); a month by its short name. `name` is the whole period's.
 */
export function periodLabel(
	starts: string[],
	i: number,
	by: "week" | "month",
): { top: string; bottom: string; name: string } {
	const start = starts[i]!
	if (by === "month")
		return { top: dayName(start, "monthShort"), bottom: "", name: dayName(start, "monthYear") }
	const newMonth = i === 0 || start.slice(5, 7) !== starts[i - 1]!.slice(5, 7)
	return {
		top: String(Number(start.slice(8))),
		bottom: newMonth ? dayName(start, "monthShort") : "",
		name: t("library.reading.periods.weekOf", { date: dayName(start, "short") }),
	}
}
