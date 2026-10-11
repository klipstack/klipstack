import { estimateCostUsd } from "@klipstack/ai"
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
	/** What this month's AI answers cost, in US dollars: an estimate from their tokens. */
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
				coalesce(sum(count) filter (where metric = 'refused'), 0)::int as refused
			from usage_counts where month = ${month} group by user_id
		),
		followed as (select user_id, count(*)::int as feeds from subscriptions group by user_id)
		select u.id, u.name, u.email, u.role,
			coalesce(c.saves, 0) as saves,
			coalesce(c.editions, 0) as editions,
			coalesce(c.ai, 0) as ai,
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
	const costs = await aiCosts(
		result.rows.map((row) => row.id),
		month,
	)
	return {
		rows: result.rows.map((row) => ({
			id: row.id,
			name: row.name,
			email: row.email,
			saves: row.saves,
			editions: row.editions,
			ai: row.ai,
			aiMax: limitsForRole(row.role).ai,
			aiCostUsd: costs.get(row.id) ?? 0,
			refused: row.refused,
			storageBytes: Number(row.storage_bytes),
			feeds: row.feeds,
		})),
		limits: defaultLimits(),
		month,
	}
}

/**
 * What the accounts' AI answers and briefs since `month` began cost, by account. Only what is still
 * stored: an answer deleted with its article no longer counts, so Anthropic's console is the bill.
 */
async function aiCosts(userIds: string[], month: string): Promise<Map<string, number>> {
	const costs = new Map<string, number>()
	if (!userIds.length) return costs
	const monthStart = `${month}T00:00:00Z`
	const ids = sql.join(
		userIds.map((id) => sql`${id}`),
		sql`, `,
	)
	const result = await db.execute<{
		user_id: string
		model: string | null
		input_tokens: string
		output_tokens: string
		cache_read_tokens: string
	}>(sql`
		select user_id, model,
			coalesce(sum(input_tokens), 0) as input_tokens,
			coalesce(sum(output_tokens), 0) as output_tokens,
			coalesce(sum(cache_read_tokens), 0) as cache_read_tokens
		from (
			select t.user_id, m.model, m.input_tokens, m.output_tokens, m.cache_read_tokens
				from ai_messages m join ai_threads t on t.id = m.thread_id
				where t.user_id in (${ids}) and m.created_at >= ${monthStart}::timestamptz
			union all
			select b.user_id, b.model, b.input_tokens, b.output_tokens, b.cache_read_tokens
				from ai_briefs b
				where b.user_id in (${ids}) and b.created_at >= ${monthStart}::timestamptz
		) spent
		group by user_id, model
	`)
	for (const row of result.rows) {
		const cost = estimateCostUsd(row.model, {
			inputTokens: Number(row.input_tokens),
			outputTokens: Number(row.output_tokens),
			cacheReadTokens: Number(row.cache_read_tokens),
		})
		costs.set(row.user_id, (costs.get(row.user_id) ?? 0) + cost)
	}
	return costs
}
