import {
	and,
	type Db,
	db,
	editionReports,
	editions,
	eq,
	highlights,
	highlightShares,
	isNotNull,
	isNull,
	type ReportReason,
	sql,
	type Tx,
} from "@klipstack/db"
import { checkAuthLimit, trustedAuthAddress } from "./auth-limits.server"
import { checkFormToken } from "./invite-requests.server"
import { limitAddress } from "./limit-address"

/** Past this many open reports the form says to try later: the table cannot grow unbounded. */
export const REPORTS_OPEN_MAX = 1000

/**
 * - `received`: the answer for a stored report, and also for a filled trap field, a post too fast
 *   for a person, or a page that is not public. Nothing tells them apart.
 * - `expired`: the form is too old, or its token is not ours. Show it again.
 * - `full`: too many reports wait already.
 */
export type ReportOutcome = "received" | "expired" | "full"

interface ReportInput {
	publicId: string
	reason: ReportReason
	details: string
	email?: string | null
	locale: string
	token: unknown
	trap: unknown
}

/**
 * Stores a visitor's report on a public edition. Nobody is emailed now: the address, when given,
 * gets one email once an admin decides. A report hides nothing by itself. The admins hear of new
 * ones in the worker's digest (`apps/worker/src/jobs/report-digest.ts`).
 * Rate limits throw better-auth's APIError, as the wait list's do (`authLimitResponse`). `tx` is
 * where the reports are counted and stored, as for `requestInvite`.
 */
export function reportEdition(input: ReportInput, headers: Headers, tx: Db | Tx = db) {
	return report(input, headers, tx, async (publicId) => {
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
		return edition ? { editionId: edition.id } : null
	})
}

/** Stores a visitor's report on a shared highlight, as `reportEdition` does for editions. */
export function reportShare(input: ReportInput, headers: Headers, tx: Db | Tx = db) {
	return report(input, headers, tx, async (publicId) => {
		const [share] = await tx
			.select({ id: highlightShares.id })
			.from(highlightShares)
			.innerJoin(highlights, eq(highlights.id, highlightShares.highlightId))
			.where(
				and(
					eq(highlightShares.publicId, publicId),
					isNotNull(highlightShares.published),
					isNull(highlightShares.removedAt),
					isNull(highlights.deletedAt),
				),
			)
		return share ? { shareId: share.id } : null
	})
}

async function report(
	{ publicId, reason, details, email, locale, token, trap }: ReportInput,
	headers: Headers,
	tx: Db | Tx,
	find: (publicId: string) => Promise<{ editionId: string } | { shareId: string } | null>,
): Promise<ReportOutcome> {
	if (typeof trap === "string" && trap !== "") return "received"
	const form = checkFormToken(token, Date.now(), "edition-report")
	if (form === "too_fast") return "received"
	if (form !== "ok") return "expired"
	// Counted per address, and per page from that address.
	await checkAuthLimit(
		"/report-edition",
		`${publicId}:${limitAddress(trustedAuthAddress(headers))}`,
		headers,
	)

	const target = await find(publicId)
	if (!target) return "received"
	// Checked apart from the insert: two reports at once may pass it together, which is harmless.
	const [open] = await tx.select({ count: sql<number>`count(*)::int` }).from(editionReports)
	if ((open?.count ?? 0) >= REPORTS_OPEN_MAX) return "full"
	await tx.insert(editionReports).values({
		...target,
		reason,
		details: details.trim(),
		email: email?.trim().toLowerCase() || null,
		locale,
	})
	return "received"
}
