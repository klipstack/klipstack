/**
 * A list position: the last row's timestamp (as PostgreSQL printed it, microseconds included) and
 * its ID. Stable while rows are added, because lists sort by (timestamp, id) descending.
 */
export interface AdminCursor {
	at: string
	id: string
}

export function encodeCursor(cursor: AdminCursor): string {
	return Buffer.from(JSON.stringify([cursor.at, cursor.id])).toString("base64url")
}

const TIMESTAMP =
	/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?[+-](\d{2})(?::(\d{2}))?$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TEXT_ID = /^[\w:-]{1,80}$/

/** A timestamp the database will accept: the queries cast it, and a failed cast is a 500. */
function validTimestamp(at: string): boolean {
	const parts = TIMESTAMP.exec(at)
	if (!parts) return false
	// The offset's minutes are optional ("+00"): an unmatched group counts as zero.
	const [year, month, day, hour, minute, second, offsetHours, offsetMinutes] = parts
		.slice(1)
		.map((part) => Number(part ?? 0)) as [
		number,
		number,
		number,
		number,
		number,
		number,
		number,
		number,
	]
	const date = new Date(Date.UTC(year, month - 1, day))
	return (
		year >= 1 &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day &&
		hour < 24 &&
		minute < 60 &&
		second < 60 &&
		offsetHours < 16 &&
		offsetMinutes < 60
	)
}

/**
 * Null for anything that is not a cursor we made: the list starts from the top. `ids` is the
 * shape of the list's ID column, since the queries cast UUIDs too.
 */
export function decodeCursor(
	value: string | null | undefined,
	ids: "uuid" | "text" = "uuid",
): AdminCursor | null {
	if (!value || value.length > 300) return null
	try {
		const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
		if (!Array.isArray(parsed) || parsed.length !== 2) return null
		const [at, id] = parsed
		if (typeof at !== "string" || typeof id !== "string") return null
		if (!validTimestamp(at) || !(ids === "uuid" ? UUID : TEXT_ID).test(id)) return null
		return { at, id }
	} catch {
		return null
	}
}
