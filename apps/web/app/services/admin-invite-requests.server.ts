import { db, type SQL, sql } from "@klipstack/db"
import { emailT } from "@klipstack/email"
import { errorLabel } from "@klipstack/log"
import {
	ADMIN_LIMITS,
	ADMIN_PAGE_SIZE,
	type AdminContext,
	adminMutation,
	assertAdminContext,
	auditActor,
	checkAdminLimit,
} from "~/lib/admin.server"
import { notFound } from "~/lib/app-error"
import { renderEmail, sendEmail } from "~/lib/email.server"
import { env } from "~/lib/env.server"
import { insertInvite } from "~/lib/invites.server"
import { recordAudit } from "./admin-audit.server"
import { decodeCursor, encodeCursor } from "./admin-cursor.server"

/** How long an invite sent to a request stays usable. */
export const REQUEST_INVITE_DAYS = 30

export interface AdminInviteRequest {
	id: string
	email: string
	note: string | null
	locale: string
	createdAt: string
}

export async function listInviteRequests(
	ctx: AdminContext,
	{ cursor }: { cursor?: string | null },
): Promise<{ requests: AdminInviteRequest[]; nextCursor: string | null; pending: number }> {
	assertAdminContext(ctx)
	const after = decodeCursor(cursor)
	const filters: SQL[] = []
	if (after) filters.push(sql`(r.created_at, r.id) < (${after.at}::timestamptz, ${after.id}::uuid)`)
	const where = filters.length ? sql`where ${sql.join(filters, sql` and `)}` : sql``
	const [result, count] = await Promise.all([
		db.execute<{
			id: string
			email: string
			note: string | null
			locale: string
			created_at: string
			cursor_at: string
		}>(sql`
			select r.id, r.email, r.note, r.locale, r.created_at, r.created_at::text as cursor_at
			from invite_requests r
			${where}
			order by r.created_at desc, r.id desc
			limit ${ADMIN_PAGE_SIZE + 1}
		`),
		db.execute<{ pending: number }>(sql`select count(*)::int as pending from invite_requests`),
	])
	const rows = result.rows.slice(0, ADMIN_PAGE_SIZE)
	const last = rows.at(-1)
	return {
		requests: rows.map((row) => ({
			id: row.id,
			email: row.email,
			note: row.note,
			locale: row.locale,
			createdAt: new Date(row.created_at).toISOString(),
		})),
		nextCursor:
			result.rows.length > ADMIN_PAGE_SIZE && last
				? encodeCursor({ at: last.cursor_at, id: last.id })
				: null,
		pending: count.rows[0]?.pending ?? 0,
	}
}

/**
 * Creates an invite for a request, deletes the request, then emails the code. The email goes after
 * the commit: a code never reaches anyone unless its invite exists. When sending fails the invite
 * stays, and the admin gets the code to send it another way.
 */
export async function approveInviteRequest(
	ctx: AdminContext,
	requestId: string,
): Promise<{ inviteId: string; code: string; email: string; emailed: boolean }> {
	const approved = await adminMutation(ctx, async (tx) => {
		await checkAdminLimit(tx, ADMIN_LIMITS.inviteCreate, ctx.userId)
		const found = await tx.execute<{ email: string; locale: string }>(sql`
			delete from invite_requests where id = ${requestId}::uuid returning email, locale
		`)
		const request = found.rows[0]
		if (!request) throw notFound("No such request.")
		const invite = await insertInvite(tx, {
			actor: auditActor(ctx),
			correlationId: ctx.correlationId,
			// The invites page shows whom it went to.
			note: request.email,
			expiry: "30d",
		})
		await recordAudit(tx, {
			actor: auditActor(ctx),
			action: "invite_request.approve",
			targetKind: "invite_request",
			targetId: requestId,
			correlationId: ctx.correlationId,
			metadata: { inviteId: invite.id },
		})
		return { ...invite, email: request.email, locale: request.locale }
	})
	let emailed = true
	try {
		await sendEmail(inviteEmail(approved))
	} catch (error) {
		// The error may name the address: log its kind only.
		console.warn(`[invite-requests] invite email failed: ${errorLabel(error)}`)
		emailed = false
	}
	return { inviteId: approved.id, code: approved.code, email: approved.email, emailed }
}

function inviteEmail({ email, locale, code }: { email: string; locale: string; code: string }) {
	const t = emailT(locale, "auth")
	const url = new URL("/signup", env.APP_URL)
	url.searchParams.set("invite", code)
	const subject = t("requestInvite.email.subject")
	return {
		to: email,
		subject,
		...renderEmail({
			heading: subject,
			body: t("requestInvite.email.body", { code, days: REQUEST_INVITE_DAYS }),
			cta: { label: t("requestInvite.email.cta"), url: url.href },
			footer: t("requestInvite.email.footer"),
		}),
	}
}

/** Deletes a request without an answer: the person gets no email. */
export function dismissInviteRequest(
	ctx: AdminContext,
	requestId: string,
): Promise<{ changed: true }> {
	return adminMutation(ctx, async (tx) => {
		await checkAdminLimit(tx, ADMIN_LIMITS.requestDismiss, ctx.userId)
		const found = await tx.execute(
			sql`delete from invite_requests where id = ${requestId}::uuid returning id`,
		)
		if (!found.rows[0]) throw notFound("No such request.")
		await recordAudit(tx, {
			actor: auditActor(ctx),
			action: "invite_request.dismiss",
			targetKind: "invite_request",
			targetId: requestId,
			correlationId: ctx.correlationId,
		})
		return { changed: true as const }
	})
}
