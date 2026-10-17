import { createHmac, timingSafeEqual } from "node:crypto"
import { type Db, db, eq, inviteRequests, sql, type Tx, user } from "@klipstack/db"
import { checkAuthLimit } from "./auth-limits.server"
import { env } from "./env.server"

export const INVITE_REQUEST_NOTE_MAX = 500
/** Past this many pending requests the form says the list is full: the table cannot grow unbounded. */
export const INVITE_REQUEST_PENDING_MAX = 500
/** A person needs longer than this to fill in the form. A bot posts at once. */
export const FORM_MIN_MS = 3_000
/** A form older than this is refused, so a bot cannot keep one token forever. */
export const FORM_MAX_MS = 24 * 60 * 60 * 1000

/** The public forms with a signed time: a token made for one does not pass the other. */
export type GuardedForm = "invite-request" | "edition-report"

const sign = (form: GuardedForm, issuedAt: string) =>
	createHmac("sha256", env.BETTER_AUTH_SECRET).update(`${form}:${issuedAt}`).digest("hex")

/** When the form was shown, signed: the post proves how long it took, and a bot cannot forge it. */
export function formToken(now = Date.now(), form: GuardedForm = "invite-request"): string {
	return `${now}.${sign(form, String(now))}`
}

export function checkFormToken(
	token: unknown,
	now = Date.now(),
	form: GuardedForm = "invite-request",
): "ok" | "too_fast" | "expired" | "invalid" {
	const [issuedAt = "", signature = ""] = typeof token === "string" ? token.split(".") : []
	const expected = sign(form, issuedAt)
	if (
		!/^[0-9]{1,15}$/.test(issuedAt) ||
		!/^[a-f0-9]{64}$/.test(signature) ||
		!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
	)
		return "invalid"
	const age = now - Number(issuedAt)
	if (age < FORM_MIN_MS) return "too_fast"
	if (age > FORM_MAX_MS) return "expired"
	return "ok"
}

/**
 * - `received`: the answer for a new request, and also for a repeat, an address that has an account,
 *   a filled trap field or a post too fast for a person. Nothing tells them apart.
 * - `expired`: the form is too old, or its token is not ours. Show it again.
 * - `full`: too many requests wait already. Says nothing about the address.
 */
export type InviteRequestOutcome = "received" | "expired" | "full"

/**
 * Stores a request for an invite. Nobody is emailed: a form that mails whatever address it is given
 * would let anyone send our mail to anyone. The admins hear of new requests in the worker's daily
 * digest (`apps/worker/src/jobs/invite-digest.ts`).
 * Rate limits throw better-auth's APIError, as sign-up's do (`authLimitResponse`). `tx` is where
 * the requests are counted and stored: a test of the cap passes a snapshot (`app/test/snapshot.ts`).
 */
export async function requestInvite(
	{
		email,
		note,
		locale,
		token,
		trap,
	}: { email: string; note?: string; locale: string; token: unknown; trap: unknown },
	headers: Headers,
	tx: Db | Tx = db,
): Promise<InviteRequestOutcome> {
	if (typeof trap === "string" && trap !== "") return "received"
	const form = checkFormToken(token)
	if (form === "too_fast") return "received"
	if (form !== "ok") return "expired"
	const normalized = email.trim().toLowerCase()
	await checkAuthLimit("/request-invite", normalized, headers)

	const [account] = await tx
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, normalized))
		.limit(1)
	if (account) return "received"
	// Checked apart from the insert: two requests at once may pass it together, which is harmless.
	const [pending] = await tx.select({ count: sql<number>`count(*)::int` }).from(inviteRequests)
	if ((pending?.count ?? 0) >= INVITE_REQUEST_PENDING_MAX) return "full"
	await tx
		.insert(inviteRequests)
		.values({ email: normalized, note: note?.trim() || null, locale })
		.onConflictDoNothing({ target: inviteRequests.email })
	return "received"
}
