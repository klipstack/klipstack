/** Home's masthead: the day's date and greeting, and the next edition in its corner. */

export type PartOfDay = "morning" | "afternoon" | "evening"

/**
 * The part of the day in a time zone: morning from 5, afternoon from 12, evening from 19 and on
 * through the night (a reader up at 2 is still in their evening, not their morning).
 */
export function partOfDay(now: Date, timeZone: string): PartOfDay {
	const hour = Number(
		new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(now),
	)
	if (hour >= 5 && hour < 12) return "morning"
	if (hour >= 12 && hour < 19) return "afternoon"
	return "evening"
}

/**
 * The date as a newspaper prints it, "Wednesday, October 14, 2026", in the reader's language and
 * time zone, capitalized as a line of its own ("Miércoles, 14 de octubre de 2026"). Format it on
 * the server: Node and browsers differ.
 */
export function mastheadDate(now: Date, locale: string, timeZone: string): string {
	const date = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone }).format(now)
	return date.charAt(0).toLocaleUpperCase(locale) + date.slice(1)
}

/** The next edition, in the masthead's corner: the draft in progress, else the articles marked. */
export type EditionEar = { draft: true; count: number } | { draft: false; count: number } | null

export function editionEar(signals: {
	marked: number
	draft: { items: number } | null
}): EditionEar {
	if (signals.draft) return { draft: true, count: signals.draft.items }
	// Nothing marked and no draft: Home says nothing of editions to a reader who may not make them.
	return signals.marked > 0 ? { draft: false, count: signals.marked } : null
}
