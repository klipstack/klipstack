import { type AdminAuditMetadata, db, sql } from "@klipstack/db"
import { ADMIN_PAGE_SIZE, type AdminContext, assertAdminContext } from "~/lib/admin.server"
import { decodeCursor, encodeCursor } from "./admin-cursor.server"

export interface AuditEntry {
	id: string
	createdAt: string
	actorKind: "user" | "operator-cli"
	actor: { id: string; name: string } | null
	action: string
	targetKind: string
	targetId: string
	correlationId: string
	metadata: AdminAuditMetadata
}

/** Read-only: nothing in the app edits or deletes events (the daily purge drops them at 90 days). */
export async function listAuditEvents(
	ctx: AdminContext,
	{ cursor }: { cursor?: string | null },
): Promise<{ events: AuditEntry[]; nextCursor: string | null }> {
	assertAdminContext(ctx)
	const after = decodeCursor(cursor)
	const result = await db.execute<{
		id: string
		created_at: Date
		actor_kind: string
		actor_id: string | null
		actor_name: string | null
		action: string
		target_kind: string
		target_id: string
		correlation_id: string
		metadata: AdminAuditMetadata
		cursor_at: string
	}>(sql`
		select e.id, e.created_at, e.actor_kind, u.id as actor_id, u.name as actor_name, e.action,
			e.target_kind, e.target_id, e.correlation_id, e.metadata, e.created_at::text as cursor_at
		from admin_audit_events e
		left join "user" u on u.id = e.actor_user_id
		${after ? sql`where (e.created_at, e.id) < (${after.at}::timestamptz, ${after.id}::uuid)` : sql``}
		order by e.created_at desc, e.id desc
		limit ${ADMIN_PAGE_SIZE + 1}
	`)
	const rows = result.rows.slice(0, ADMIN_PAGE_SIZE)
	const last = rows.at(-1)
	return {
		events: rows.map((row) => ({
			id: row.id,
			createdAt: new Date(row.created_at).toISOString(),
			actorKind: row.actor_kind === "operator-cli" ? "operator-cli" : "user",
			actor:
				row.actor_id && row.actor_name != null ? { id: row.actor_id, name: row.actor_name } : null,
			action: row.action,
			targetKind: row.target_kind,
			targetId: row.target_id,
			correlationId: row.correlation_id,
			metadata: row.metadata ?? {},
		})),
		nextCursor:
			result.rows.length > ADMIN_PAGE_SIZE && last
				? encodeCursor({ at: last.cursor_at, id: last.id })
				: null,
	}
}
