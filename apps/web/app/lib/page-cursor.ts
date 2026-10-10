/**
 * The values page cursors and ids carry into queries. Postgres refuses a malformed time or uuid
 * with an error, which would answer a bad cursor or link with a 500: check them first.
 */

const TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?Z$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A UTC time to the microsecond, as the queries write them, that Postgres can read back. */
export function isCursorTime(value: unknown): value is string {
	if (typeof value !== "string") return false
	const m = TIME.exec(value)
	if (!m) return false
	const [year, month, day, hour, minute, second] = m.slice(1).map(Number) as number[]
	const monthDays = new Date(Date.UTC(year!, month!, 0)).getUTCDate()
	return (
		year! >= 1 &&
		month! >= 1 &&
		month! <= 12 &&
		day! >= 1 &&
		day! <= monthDays &&
		hour! < 24 &&
		minute! < 60 &&
		second! < 60
	)
}

export const isUuid = (value: unknown): value is string =>
	typeof value === "string" && UUID.test(value)

/** A Postgres integer: the article sort keys (reading minutes, or ±2^31 sentinels). */
export const isInt4 = (value: unknown): value is number =>
	Number.isInteger(value) && (value as number) >= -(2 ** 31) && (value as number) <= 2 ** 31 - 1

/** The JSON object in a base64url cursor, or null. */
export function cursorFields(value: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
	} catch {
		return null
	}
}
