import { type SQL, sql } from "drizzle-orm"
import { accountBilling, user } from "./schema"

/**
 * Where an account stands with billing, for the web's caps and the worker alike:
 * - `unbilled`: billing is off (`BILLING_STARTS_AT` unset or still ahead). Today's caps.
 * - `trial`: an account made since billing started, for `TRIAL_DAYS`. The trial's caps.
 * - `free`: the paid plan at no charge: admins always, accounts made before billing started for
 *   `FOUNDING_FREE_DAYS` after it, and whoever an admin gives a `free_until`. That date replaces
 *   the founding year and the trial alike: a past one ends either.
 * - `lapsed`: none of those. The library stays readable and exportable; nothing new is added.
 */
export type PlanState = "unbilled" | "trial" | "free" | "lapsed"

export const TRIAL_DAYS = 30
export const FOUNDING_FREE_DAYS = 365

/** `BILLING_STARTS_AT`, a date or a time; unset or empty is null. A bad one is an error. */
export function billingStartsAt(source: Record<string, string | undefined> = process.env) {
	const raw = source.BILLING_STARTS_AT?.trim()
	if (!raw) return null
	const start = new Date(raw)
	if (Number.isNaN(start.getTime()))
		throw new Error(`BILLING_STARTS_AT must be a date like 2026-12-01, not "${raw}"`)
	return start
}

const toDate = (value: unknown) => (value === null ? null : new Date(value as string))

/**
 * The account's state and, but for `unbilled` and admins, when it ends (or ended, when `lapsed`),
 * as columns of a query over `user` left-joined with `account_billing` on the user.
 */
export function planColumns(
	start: Date | null,
	now = new Date(),
): { state: SQL<PlanState>; until: SQL<Date | null> } {
	if (!start || now < start)
		return { state: sql<PlanState>`'unbilled'`, until: sql<null>`null::timestamptz` }
	const at = sql`${now.toISOString()}::timestamptz`
	const from = sql`${start.toISOString()}::timestamptz`
	// Days of 24 hours, whatever the session's time zone (a calendar day can be 23 or 25).
	const days = (n: number) => sql`make_interval(hours => ${n * 24})`
	// An admin's date replaces both the founding year and the trial: it can end either early.
	const given = sql`${accountBilling.freeUntil} is not null`
	const free = sql`coalesce(${accountBilling.freeUntil}, case when ${user.createdAt} < ${from} then ${from} + ${days(FOUNDING_FREE_DAYS)} end)`
	const trial = sql`case when not ${given} and ${user.createdAt} >= ${from} then ${user.createdAt} + ${days(TRIAL_DAYS)} end`
	const admin = sql`${user.role} = 'admin'`
	return {
		state: sql<PlanState>`case when ${admin} then 'free' when ${free} > ${at} then 'free' when ${trial} > ${at} then 'trial' else 'lapsed' end`,
		until:
			sql<Date | null>`case when ${admin} then null when ${free} > ${at} then ${free} when ${trial} > ${at} then ${trial} else greatest(${free}, ${trial}) end`.mapWith(
				toDate,
			),
	}
}

/** True for an account that may add to its library: any state but `lapsed`. For the worker. */
export function mayAddSql(start: Date | null, now = new Date()): SQL<boolean> {
	return sql<boolean>`(${planColumns(start, now).state}) <> 'lapsed'`
}
