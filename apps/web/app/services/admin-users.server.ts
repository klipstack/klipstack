import { db, type SQL, sql } from "@klipstack/db"
import { USER_SEARCH_MAX } from "~/lib/admin-constants"
import { ADMIN_PAGE_SIZE, type AdminContext, assertAdminContext } from "~/lib/admin.server"
import { decodeCursor, encodeCursor } from "./admin-cursor.server"

/** Account metadata only. No credentials, sessions' tokens, content, or invented activity times. */
export interface AdminUserSummary {
	id: string
	name: string
	email: string
	role: "user" | "admin"
	emailVerified: boolean
	createdAt: string
}

export interface AdminUserDetail extends AdminUserSummary {
	invitedBy: { id: string; name: string } | null
	articles: number
	highlights: number
	activeSessions: number
}

/** The search is literal: `%`, `_` and `\` in it match themselves. */
export function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

const toRole = (role: string): "user" | "admin" => (role === "admin" ? "admin" : "user")

export async function listUsers(
	ctx: AdminContext,
	{ query, cursor }: { query?: string | null; cursor?: string | null },
): Promise<{ users: AdminUserSummary[]; nextCursor: string | null }> {
	assertAdminContext(ctx)
	const after = decodeCursor(cursor, "text")
	const filters: SQL[] = []
	const needle = query?.trim().slice(0, USER_SEARCH_MAX)
	if (needle) {
		const pattern = `%${escapeLike(needle)}%`
		filters.push(sql`(u.name ilike ${pattern} or u.email ilike ${pattern})`)
	}
	if (after) filters.push(sql`(u.created_at, u.id) < (${after.at}::timestamptz, ${after.id})`)
	const where = filters.length ? sql`where ${sql.join(filters, sql` and `)}` : sql``
	const result = await db.execute<{
		id: string
		name: string
		email: string
		role: string
		email_verified: boolean
		created_at: Date
		cursor_at: string
	}>(sql`
		select u.id, u.name, u.email, u.role, u.email_verified, u.created_at,
			u.created_at::text as cursor_at
		from "user" u
		${where}
		order by u.created_at desc, u.id desc
		limit ${ADMIN_PAGE_SIZE + 1}
	`)
	const rows = result.rows.slice(0, ADMIN_PAGE_SIZE)
	const last = rows.at(-1)
	return {
		users: rows.map((row) => ({
			id: row.id,
			name: row.name,
			email: row.email,
			role: toRole(row.role),
			emailVerified: row.email_verified,
			createdAt: new Date(row.created_at).toISOString(),
		})),
		nextCursor:
			result.rows.length > ADMIN_PAGE_SIZE && last
				? encodeCursor({ at: last.cursor_at, id: last.id })
				: null,
	}
}

export async function getUserDetail(
	ctx: AdminContext,
	userId: string,
): Promise<AdminUserDetail | null> {
	assertAdminContext(ctx)
	const result = await db.execute<{
		id: string
		name: string
		email: string
		role: string
		email_verified: boolean
		created_at: Date
		inviter_id: string | null
		inviter_name: string | null
		articles: number
		highlights: number
		active_sessions: number
	}>(sql`
		select u.id, u.name, u.email, u.role, u.email_verified, u.created_at,
			inviter.id as inviter_id, inviter.name as inviter_name,
			(select count(*)::int from documents d where d.user_id = u.id and d.deleted_at is null) as articles,
			(select count(*)::int from highlights h where h.user_id = u.id and h.deleted_at is null) as highlights,
			(select count(*)::int from session s where s.user_id = u.id and s.expires_at > now()) as active_sessions
		from "user" u
		left join lateral (
			select c.id, c.name from invites i join "user" c on c.id = i.created_by
			where i.used_by = u.id order by i.used_at desc limit 1
		) inviter on true
		where u.id = ${userId}
	`)
	const row = result.rows[0]
	if (!row) return null
	return {
		id: row.id,
		name: row.name,
		email: row.email,
		role: toRole(row.role),
		emailVerified: row.email_verified,
		createdAt: new Date(row.created_at).toISOString(),
		invitedBy:
			row.inviter_id && row.inviter_name != null
				? { id: row.inviter_id, name: row.inviter_name }
				: null,
		articles: row.articles,
		highlights: row.highlights,
		activeSessions: row.active_sessions,
	}
}
