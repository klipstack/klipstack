/**
 * The reader's day on the device, as `dailyHighlights.list` takes it (YYYY-MM-DD): Home's
 * highlights change at the reader's midnight, not at UTC's.
 */
export function localDay(now: Date = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, "0")
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
