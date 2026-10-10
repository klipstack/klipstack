import { db, type SQL, sql } from "@klipstack/db"
import type { InviteExpiry, InviteStatus } from "~/lib/admin-constants"
import {
	ADMIN_LIMITS,
	ADMIN_PAGE_SIZE,
	type AdminContext,
	adminMutation,
	assertAdminContext,
	auditActor,
	checkAdminLimit,
} from "~/lib/admin.server"
import { AppError, notFound } from "~/lib/app-error"
import { insertInvite } from "~/lib/invites.server"
import { recordAudit } from "./admin-audit.server"
import { decodeCursor, encodeCursor } from "./admin-cursor.server"

/** What the invites page may show. The code is here on purpose: copying it is the feature. */
export interface AdminInvite {
	id: string
	code: string
	note: string | null
	status: InviteStatus
	createdAt: string
	expiresAt: string | null
	usedAt: string | null
	revokedAt: string | null
	createdBy: { id: string; name: string } | null
	usedBy: { id: string; name: string } | null
}

/** Revoked wins over expired (revoking shortens the expiry); used wins over both. */
const STATUS_SQL = sql`case
	when i.used_at is not null or i.used_by is not null then 'used'
	when i.revoked_at is not null then 'revoked'
	when i.expires_at is not null and i.expires_at <= now() then 'expired'
	else 'active' end`

export async function listInvites(
	ctx: AdminContext,
	{ status, cursor }: { status?: InviteStatus | null; cursor?: string | null },
): Promise<{ invites: AdminInvite[]; nextCursor: string | null }> {
	assertAdminContext(ctx)
	const after = decodeCursor(cursor)
	const filters: SQL[] = []
	if (status) filters.push(sql`${STATUS_SQL} = ${status}`)
	if (after) filters.push(sql`(i.created_at, i.id) < (${after.at}::timestamptz, ${after.id}::uuid)`)
	const where = filters.length ? sql`where ${sql.join(filters, sql` and `)}` : sql``
	const result = await db.execute<{
		id: string
		code: string
		note: string | null
		status: InviteStatus
		created_at: string
		expires_at: string | null
		used_at: string | null
		revoked_at: string | null
		creator_id: string | null
		creator_name: string | null
		redeemer_id: string | null
		redeemer_name: string | null
		cursor_at: string
	}>(sql`
		select i.id, i.code, i.note, ${STATUS_SQL} as status,
			i.created_at, i.expires_at, i.used_at, i.revoked_at,
			c.id as creator_id, c.name as creator_name, r.id as redeemer_id, r.name as redeemer_name,
			i.created_at::text as cursor_at
		from invites i
		left join "user" c on c.id = i.created_by
		left join "user" r on r.id = i.used_by
		${where}
		order by i.created_at desc, i.id desc
		limit ${ADMIN_PAGE_SIZE + 1}
	`)
	const rows = result.rows.slice(0, ADMIN_PAGE_SIZE)
	const last = rows.at(-1)
	const iso = (value: string | null) => (value ? new Date(value).toISOString() : null)
	return {
		invites: rows.map((row) => ({
			id: row.id,
			code: row.code,
			note: row.note,
			status: row.status,
			createdAt: new Date(row.created_at).toISOString(),
			expiresAt: iso(row.expires_at),
			usedAt: iso(row.used_at),
			revokedAt: iso(row.revoked_at),
			createdBy:
				row.creator_id && row.creator_name != null
					? { id: row.creator_id, name: row.creator_name }
					: null,
			usedBy:
				row.redeemer_id && row.redeemer_name != null
					? { id: row.redeemer_id, name: row.redeemer_name }
					: null,
		})),
		nextCursor:
			result.rows.length > ADMIN_PAGE_SIZE && last
				? encodeCursor({ at: last.cursor_at, id: last.id })
				: null,
	}
}

export function createAdminInvite(
	ctx: AdminContext,
	input: { note?: string | null; expiry: InviteExpiry },
): Promise<{ id: string; code: string }> {
	return adminMutation(ctx, async (tx) => {
		await checkAdminLimit(tx, ADMIN_LIMITS.inviteCreate, ctx.userId)
		return insertInvite(tx, {
			actor: auditActor(ctx),
			correlationId: ctx.correlationId,
			note: input.note,
			expiry: input.expiry,
		})
	})
}

/**
 * Older signup code knows only `expires_at`, and compares it with the application's clock, not the
 * database's. The margin keeps a revoked invite expired for that code when the two clocks differ.
 */
export const REVOKED_EXPIRY_MARGIN_MINUTES = 5

/**
 * Revokes an unused invite. The row lock is the one signup takes (`findUsableInvite`): of a signup
 * and a revoke at once, one wins. The expiry is shortened too, never extended, so code that
 * predates `revoked_at` (a rollback) refuses the invite as expired.
 */
export function revokeInvite(ctx: AdminContext, inviteId: string): Promise<{ changed: boolean }> {
	return adminMutation(ctx, async (tx) => {
		await checkAdminLimit(tx, ADMIN_LIMITS.inviteRevoke, ctx.userId)
		const found = await tx.execute<{ used: boolean; revoked: boolean }>(sql`
			select (used_at is not null or used_by is not null) as used, revoked_at is not null as revoked
			from invites where id = ${inviteId}::uuid for update
		`)
		const invite = found.rows[0]
		if (!invite) throw notFound("No such invite.")
		if (invite.used)
			throw new AppError("invite_used", "That invite was already used. It cannot be revoked.")
		if (invite.revoked) return { changed: false }
		await tx.execute(sql`
			update invites
			set revoked_at = now(),
				expires_at = least(expires_at, now() - ${REVOKED_EXPIRY_MARGIN_MINUTES} * interval '1 minute')
			where id = ${inviteId}::uuid
		`)
		await recordAudit(tx, {
			actor: auditActor(ctx),
			action: "invite.revoke",
			targetKind: "invite",
			targetId: inviteId,
			correlationId: ctx.correlationId,
			metadata: { inviteId },
		})
		return { changed: true }
	})
}
