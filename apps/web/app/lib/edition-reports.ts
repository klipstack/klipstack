import type { ReportReason } from "@klipstack/db"

/**
 * Why someone reports a public edition, and the ground an admin removes one on: the database's
 * `reportReasons`, here for the browser.
 */
export const REPORT_REASONS = [
	"spam",
	"illegal",
	"copyright",
	"abuse",
	"other",
] as const satisfies readonly ReportReason[]

export function isReportReason(value: unknown): value is ReportReason {
	return typeof value === "string" && (REPORT_REASONS as readonly string[]).includes(value)
}

export const REPORT_DETAILS_MAX = 2000
/** What an admin tells the owner of a removed edition. */
export const REMOVAL_NOTE_MAX = 1000
