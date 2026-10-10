import { db, sql } from "@klipstack/db"

/**
 * What browser tests leave in the database, by the names their helpers give it: accounts from
 * `uniqueEmail` (`<prefix>+<Date.now()><random>@example.com`; example.com is reserved, so no real
 * account matches) and the wait list requests and invites made for them, invites noted "e2e", feeds on `<word>-<digits>.example.com`, and OAuth clients
 * whose ID starts with `e2e-`. Deleting an account cascades to its articles, highlights, sessions,
 * keys and grants; invites and audit events only lose the reference, so they go first.
 */
const E2E_EMAIL = String.raw`\+[0-9]{13,17}@example\.com$`
const E2E_FEED = String.raw`^https?://[a-z]+-[0-9]{13,17}\.example\.com`

export interface CleanupWindow {
	/** Only rows created at or after this time (a run's own data). */
	since?: Date
	/** Only rows created before this time (what interrupted runs left behind). */
	before?: Date
}

export type CleanupCounts = Record<
	"users" | "invites" | "requests" | "auditEvents" | "feeds" | "clients",
	number
>

/** Tests only ever run against a local database: refuse anything else, whatever the pattern. */
function assertLocalDatabase() {
	const host = new URL(process.env.DATABASE_URL ?? "postgres://missing").hostname
	if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(host))
		throw new Error(`e2e cleanup refuses a database on "${host}": local databases only`)
}

export async function cleanE2eData({ since, before }: CleanupWindow = {}): Promise<CleanupCounts> {
	assertLocalDatabase()
	const from = since ?? new Date(0)
	const until = before ?? new Date(Date.now() + 86_400_000)
	const created = (column: string) =>
		sql`${sql.raw(column)} >= ${from.toISOString()}::timestamptz and ${sql.raw(column)} < ${until.toISOString()}::timestamptz`
	return db.transaction(async (tx) => {
		await tx.execute(sql`
			create temp table e2e_gone on commit drop as
			select id from "user" where email ~ ${E2E_EMAIL} and ${created("created_at")}`)
		await tx.execute(sql`
			create temp table e2e_invites on commit drop as
			select id from invites
			where used_by in (select id from e2e_gone) or created_by in (select id from e2e_gone)
				or (note = 'e2e' and used_by is null and ${created("created_at")})
				-- Sent to a wait list request: the note is the address.
				or (note ~ ${E2E_EMAIL} and used_by is null and ${created("created_at")})`)
		const auditEvents = await tx.execute(sql`
			delete from admin_audit_events
			where actor_user_id in (select id from e2e_gone)
				or target_id in (select id from e2e_gone)
				or target_id in (select id::text from e2e_invites)`)
		const invites = await tx.execute(
			sql`delete from invites where id in (select id from e2e_invites)`,
		)
		const users = await tx.execute(sql`delete from "user" where id in (select id from e2e_gone)`)
		const requests = await tx.execute(
			sql`delete from invite_requests where email ~ ${E2E_EMAIL} and ${created("created_at")}`,
		)
		// After the accounts: their subscriptions are gone, so a fixture feed has nobody left.
		const feeds = await tx.execute(sql`
			delete from feeds f
			where f.url ~ ${E2E_FEED} and ${created("f.created_at")}
				and not exists (select 1 from subscriptions s where s.feed_id = f.id)`)
		const clients = await tx.execute(
			sql`delete from oauth_client where client_id like 'e2e-%' and ${created("created_at")}`,
		)
		// Audit events keep their row when the account, invite or article goes (the reference is
		// nulled, or is only text). Locally that is just the residue of deleted fixtures.
		const orphans = await tx.execute(sql`
			delete from admin_audit_events e
			where ${created("e.created_at")} and (
				(e.target_kind = 'user' and not exists (select 1 from "user" u where u.id = e.target_id))
				or (e.target_kind = 'invite'
					and not exists (select 1 from invites i where i.id::text = e.target_id))
				or (e.target_kind = 'invite_request'
					and not exists (select 1 from invite_requests r where r.id::text = e.target_id))
				or (e.target_kind in ('document', 'job') and not exists (
					select 1 from documents d where d.id::text = e.metadata->>'documentId'))
			)`)
		return {
			users: users.rowCount ?? 0,
			invites: invites.rowCount ?? 0,
			requests: requests.rowCount ?? 0,
			auditEvents: (auditEvents.rowCount ?? 0) + (orphans.rowCount ?? 0),
			feeds: feeds.rowCount ?? 0,
			clients: clients.rowCount ?? 0,
		}
	})
}
