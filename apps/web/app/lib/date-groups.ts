/**
 * List sections by how long ago something happened (archived, starred), in the reader's time zone.
 * Safe to import from client code.
 */

/** The browser's time zone, so the server draws "Today" where the reader's day starts. */
export const TIME_ZONE_COOKIE = "klip_tz"

export function timeZoneFromCookie(cookieHeader: string | null | undefined): string {
	return knownTimeZone(cookieHeader) ?? "UTC"
}

/** The browser's time zone, as its cookie says; null before the browser has said it. */
export function knownTimeZone(cookieHeader: string | null | undefined): string | null {
	const match = /(?:^|;\s*)klip_tz=([^;]+)/.exec(cookieHeader ?? "")
	const zone = match?.[1] ? decodeOr(match[1], "") : ""
	return isTimeZone(zone) ? zone : null
}

/** A cookie is the browser's to change: a broken encoding is no zone, not a failed page. */
function decodeOr(value: string, fallback: string) {
	try {
		return decodeURIComponent(value)
	} catch {
		return fallback
	}
}

/**
 * A zone by name (America/Santiago), as both JavaScript and Postgres read it. An offset like
 * "+01:00" is refused: JavaScript accepts it, but Postgres reads it as a POSIX zone, with the sign
 * the other way round, so the server's SQL and its JavaScript would disagree by twice the offset.
 */
export function isTimeZone(zone: string): boolean {
	if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(zone)) return false
	try {
		new Intl.DateTimeFormat("en", { timeZone: zone })
		return true
	} catch {
		return false
	}
}

/** Stores the browser's time zone when the cookie is missing or stale. */
export function rememberTimeZone() {
	const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
	if (!zone || knownTimeZone(document.cookie) === zone) return
	// oxlint-disable-next-line unicorn/no-document-cookie -- a single first-party cookie, no library needed
	document.cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(zone)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
}

/**
 * "today", "yesterday", "week" (the 7 days before), "month" (earlier this month), then
 * "month:YYYY-MM" for earlier months of this year and "year:YYYY" before that.
 */
export type DateGroup = string

export function dateGroup(date: Date, now: Date, timeZone: string): DateGroup {
	const a = calendarDay(date, timeZone)
	const b = calendarDay(now, timeZone)
	const days = Math.round((b.index - a.index) / 86_400_000)
	if (days <= 0) return "today"
	if (days === 1) return "yesterday"
	if (days < 7) return "week"
	if (a.year === b.year && a.month === b.month) return "month"
	if (a.year === b.year) return `month:${a.year}-${String(a.month).padStart(2, "0")}`
	return `year:${a.year}`
}

function calendarDay(date: Date, timeZone: string) {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(date)
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
	const year = get("year")
	const month = get("month")
	return { year, month, index: Date.UTC(year, month - 1, get("day")) }
}

/** Heading text: named groups come from i18n; months and years are formatted for the language. */
export function dateGroupLabel(
	group: DateGroup,
	language: string,
	named: (key: "today" | "yesterday" | "week" | "month") => string,
): string {
	if (group.startsWith("month:")) {
		const [year, month] = group.slice(6).split("-").map(Number)
		const label = new Intl.DateTimeFormat(language, { month: "long", timeZone: "UTC" }).format(
			new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, 15)),
		)
		return label.charAt(0).toLocaleUpperCase(language) + label.slice(1)
	}
	if (group.startsWith("year:")) return group.slice(5)
	return named(group as "today" | "yesterday" | "week" | "month")
}

/**
 * A day as the reader's calendar shows it. Format it in the loader and send the text: Node and
 * browsers format some dates differently, and the server can't know the browser's locale and
 * zone, so formatting during render breaks hydration.
 */
export function formatDay(value: Date | string, locale: string, timeZone: string): string {
	return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone }).format(new Date(value))
}
