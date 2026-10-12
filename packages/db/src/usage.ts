import { and, eq, sql } from "drizzle-orm"
import type { Tx } from "./client"
import { type UsageMetric, usageCounts } from "./schema"

/** The month a count goes to (its first day, UTC), and when the next one starts. */
export function monthOf(now = new Date()): { month: string; resetsAt: Date } {
	const year = now.getUTCFullYear()
	const month = now.getUTCMonth()
	return {
		month: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
		resetsAt: new Date(Date.UTC(year, month + 1, 1)),
	}
}

/**
 * Adds `by` to an account's `metric` for a month (this one by default), and answers the new count.
 * For the web app's caps and the worker's alike.
 */
export async function addUsage(
	runner: Pick<Tx, "insert">,
	userId: string,
	metric: UsageMetric,
	by = 1,
	month = monthOf().month,
): Promise<number> {
	const [row] = await runner
		.insert(usageCounts)
		.values({ userId, metric, month, count: by })
		.onConflictDoUpdate({
			target: [usageCounts.userId, usageCounts.metric, usageCounts.month],
			set: { count: sql`${usageCounts.count} + ${by}` },
		})
		.returning({ count: usageCounts.count })
	return row!.count
}

/** An account's `metric` this month (or `month`): 0 before the first. */
export async function usageThisMonth(
	runner: Pick<Tx, "select">,
	userId: string,
	metric: UsageMetric,
	month = monthOf().month,
): Promise<number> {
	const [row] = await runner
		.select({ count: usageCounts.count })
		.from(usageCounts)
		.where(
			and(
				eq(usageCounts.userId, userId),
				eq(usageCounts.metric, metric),
				eq(usageCounts.month, month),
			),
		)
	return row?.count ?? 0
}

/** Haiku's work on one account's topics a month (proposing, growing, reviewing), by default. */
export const TOPICS_PER_MONTH = 100
/** Articles sorted into one account's topics a month, first sorts and re-sorts alike, by default. */
export const TOPIC_SORTS_PER_MONTH = 1000

/**
 * The topics' monthly caps, for the worker and the web alike: `LIMIT_TOPICS_PER_MONTH` and
 * `LIMIT_TOPIC_SORTS_PER_MONTH`, or the defaults when unset or not a whole number. 0 stops it.
 */
export function topicLimits(source: Record<string, string | undefined> = process.env): {
	topics: number
	sorts: number
} {
	const read = (name: string, fallback: number) => {
		const raw = source[name]
		const value = Number(raw)
		return raw !== undefined && raw !== "" && Number.isInteger(value) && value >= 0
			? value
			: fallback
	}
	return {
		topics: read("LIMIT_TOPICS_PER_MONTH", TOPICS_PER_MONTH),
		sorts: read("LIMIT_TOPIC_SORTS_PER_MONTH", TOPIC_SORTS_PER_MONTH),
	}
}
