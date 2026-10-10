const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
	["year", 365 * 86_400],
	["month", 30 * 86_400],
	["week", 7 * 86_400],
	["day", 86_400],
	["hour", 3_600],
	["minute", 60],
]

export function relativeTime(date: Date | string, language: string): string {
	const seconds = (new Date(date).getTime() - Date.now()) / 1000
	const format = new Intl.RelativeTimeFormat(language, { numeric: "auto" })
	for (const [unit, size] of UNITS)
		if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit)
	return format.format(0, "minute")
}
