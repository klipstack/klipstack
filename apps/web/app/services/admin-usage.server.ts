import { db, sql, type UserRole } from "@klipstack/db"
import { USAGE_TOP, type UsageOrder } from "~/lib/admin-constants"
import { type AdminContext, assertAdminContext } from "~/lib/admin.server"
import {
	defaultLimits,
	type Limits,
	limitsForRole,
	monthOf,
	storedBytes,
} from "~/lib/limits.server"

export interface AdminUsageRow {
	id: string
	name: string
	email: string
	/** This calendar month (UTC), as the caps count them. */
	saves: number
	editions: number
	/** AI questions, and the account's cap: admins have their own. */
	ai: number
	aiMax: number
	/** What this month's AI answers cost, in US dollars: estimated from their tokens when paid for. */
	aiCostUsd: number
	/** Refusals by any cap this month. Repeated ones suggest a script. */
	refused: number
	storageBytes: number
	feeds: number
}

/** Each account's standing against the caps, as numbers only. */
export async function listUsage(
	ctx: AdminContext,
	by: UsageOrder,
): Promise<{
	rows: AdminUsageRow[]
	/** The caps every account has today, but for `aiMax`; a plan would make them a column. */
	limits: Limits
	/** The month counted: its first day, UTC. */
	month: string
	/** What AI cost this month, every account's, listed or not. */
	aiCostUsd: number
}> {
	assertAdminContext(ctx)
	const { month } = monthOf()
	const order = {
		refused: sql`refused`,
		storage: sql`storage_bytes`,
		saves: sql`saves`,
		feeds: sql`feeds`,
		ai: sql`ai`,
	}[by]
	const result = await db.execute<{
		id: string
		name: string
		email: string
		role: UserRole
		saves: number
		editions: number
		ai: number
		ai_spend: string
		refused: number
		storage_bytes: string
		feeds: number
	}>(sql`
		with stored as (
			select s.user_id, sum(s.bytes) as bytes from (${storedBytes()}) s group by s.user_id
		),
		counted as (
			select user_id,
				coalesce(sum(count) filter (where metric = 'saves'), 0)::int as saves,
				coalesce(sum(count) filter (where metric = 'editions'), 0)::int as editions,
				coalesce(sum(count) filter (where metric = 'ai'), 0)::int as ai,
				coalesce(sum(count) filter (where metric = 'ai_spend'), 0)::bigint as ai_spend,
				coalesce(sum(count) filter (where metric = 'refused'), 0)::int as refused
			from usage_counts where month = ${month} group by user_id
		),
		followed as (select user_id, count(*)::int as feeds from subscriptions group by user_id)
		select u.id, u.name, u.email, u.role,
			coalesce(c.saves, 0) as saves,
			coalesce(c.editions, 0) as editions,
			coalesce(c.ai, 0) as ai,
			coalesce(c.ai_spend, 0) as ai_spend,
			coalesce(c.refused, 0) as refused,
			coalesce(s.bytes, 0) as storage_bytes,
			coalesce(f.feeds, 0) as feeds
		from "user" u
		left join stored s on s.user_id = u.id
		left join counted c on c.user_id = u.id
		left join followed f on f.user_id = u.id
		order by ${order} desc, storage_bytes desc, u.created_at desc, u.id
		limit ${USAGE_TOP}
	`)
	const [spent] = (
		await db.execute<{ micros: string | null }>(
			sql`select sum(count) as micros from usage_counts where metric = 'ai_spend' and month = ${month}`,
		)
	).rows
	return {
		rows: result.rows.map((row) => ({
			id: row.id,
			name: row.name,
			email: row.email,
			saves: row.saves,
			editions: row.editions,
			ai: row.ai,
			aiMax: limitsForRole(row.role).ai,
			aiCostUsd: Number(row.ai_spend) / 1_000_000,
			refused: row.refused,
			storageBytes: Number(row.storage_bytes),
			feeds: row.feeds,
		})),
		limits: defaultLimits(),
		month,
		aiCostUsd: Number(spent?.micros ?? 0) / 1_000_000,
	}
}
