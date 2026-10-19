import { type Db, db, sql, type Tx } from "@klipstack/db"
import { ACTIVITY_DAYS } from "~/lib/admin-constants"
import { type AdminContext, assertAdminContext } from "~/lib/admin.server"
import { starterTexts, starterUrlHash } from "~/lib/starter-texts.server"

export interface ActivityDay {
	/** The UTC day, `YYYY-MM-DD`. */
	day: string
	/** Articles saved, but for the starter texts offered at sign-up. */
	saved: number
	highlighted: number
	/** Articles finished one at a time: by hand, by reading or listening to the end. */
	finished: number
	/** Accounts that did any of the above that day. */
	people: number
}

/**
 * How much Klipstack was used each UTC day, newest first: totals across every account but the
 * admins', with no one's name and nothing about what was read. Counted from the rows as they are
 * now, so an article or account deleted since no longer counts on its day. `tx` is where to read,
 * as for `listUsage`.
 */
export async function listActivity(
	ctx: AdminContext,
	now = new Date(),
	tx: Db | Tx = db,
): Promise<ActivityDay[]> {
	assertAdminContext(ctx)
	const today = sql`(${now.toISOString()}::timestamptz at time zone 'utc')::date`
	const first = sql`(${today} - ${ACTIVITY_DAYS - 1}::int)`
	const since = sql`(${first}::timestamp at time zone 'utc')`
	const starters = starterTexts().map((text) => sql`${starterUrlHash(text)}`)
	const result = await tx.execute<{
		day: string
		saved: number
		highlighted: number
		finished: number
		people: number
	}>(sql`
		with members as (select id from "user" where role <> 'admin'),
		events as (
			select 'saved' as kind, d.user_id, d.created_at as at from documents d
			where d.created_at >= ${since} and d.url_hash not in (${sql.join(starters, sql`, `)})
			union all
			select 'highlighted', h.user_id, h.created_at from highlights h
			where h.created_at >= ${since}
			union all
			select 'finished', c.user_id, c.completed_at from reading_completions c
			where c.completed_at >= ${since} and c.source in ('manual', 'progress', 'listened')
		),
		counted as (
			select (e.at at time zone 'utc')::date as day, e.kind, e.user_id
			from events e join members m on m.id = e.user_id
		)
		select to_char(days.day, 'YYYY-MM-DD') as day,
			count(c.kind) filter (where c.kind = 'saved')::int as saved,
			count(c.kind) filter (where c.kind = 'highlighted')::int as highlighted,
			count(c.kind) filter (where c.kind = 'finished')::int as finished,
			count(distinct c.user_id)::int as people
		from generate_series(${first}, ${today}, interval '1 day') as days(day)
		left join counted c on c.day = days.day::date
		group by days.day
		order by days.day desc
	`)
	return result.rows
}
