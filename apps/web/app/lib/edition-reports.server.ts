import {
	and,
	type Db,
	db,
	editionReports,
	editions,
	eq,
	isNotNull,
	isNull,
	type ReportReason,
	sql,
	type Tx,
} from "@klipstack/db"
import { checkAuthLimit, trustedAuthAddress } from "./auth-limits.server"
import { checkFormToken } from "./invite-requests.server"

/** Past this many open reports the form says to try later: the table cannot grow unbounded. */
export const REPORTS_OPEN_MAX = 1000

/**
 * - `received`: the answer for a stored report, and also for a filled trap field, a post too fast
 *   for a person, or an edition that is not public. Nothing tells them apart.
 * - `expired`: the form is too old, or its token is not ours. Show it again.
 * - `full`: too many reports wait already.
 */
export type ReportOutcome = "received" | "expired" | "full"

/**
 * Stores a visitor's report on a public edition. Nobody is emailed now: the address, when given,
 * gets one email once an admin decides. A report hides nothing by itself. The admins hear of new
 * ones in the worker's digest (`apps/worker/src/jobs/report-digest.ts`).
 * Rate limits throw better-auth's APIError, as the wait list's do (`authLimitResponse`). `tx` is
 * where the reports are counted and stored, as for `requestInvite`.
 */
export async function reportEdition(
	{
		publicId,
		reason,
		details,
		email,
		locale,
		token,
		trap,
	}: {
		publicId: string
		reason: ReportReason
		details: string
		email?: string | null
		locale: string
		token: unknown
		trap: unknown
	},
	headers: Headers,
	tx: Db | Tx = db,
): Promise<ReportOutcome> {
	if (typeof trap === "string" && trap !== "") return "received"
	const form = checkFormToken(token, Date.now(), "edition-report")
	if (form === "too_fast") return "received"
	if (form !== "ok") return "expired"
	// Counted per address, and per edition from that address.
	await checkAuthLimit("/report-edition", `${publicId}:${trustedAuthAddress(headers)}`, headers)

	const [edition] = await tx
		.select({ id: editions.id })
		.from(editions)
		.where(
			and(
				eq(editions.publicId, publicId),
				isNotNull(editions.publishedAt),
				isNull(editions.unpublishedAt),
				isNull(editions.removedAt),
			),
		)
	if (!edition) return "received"
	// Checked apart from the insert: two reports at once may pass it together, which is harmless.
	const [open] = await tx.select({ count: sql<number>`count(*)::int` }).from(editionReports)
	if ((open?.count ?? 0) >= REPORTS_OPEN_MAX) return "full"
	await tx.insert(editionReports).values({
		editionId: edition.id,
		reason,
		details: details.trim(),
		email: email?.trim().toLowerCase() || null,
		locale,
	})
	return "received"
}
