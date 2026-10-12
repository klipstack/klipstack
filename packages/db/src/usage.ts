import { sql } from "drizzle-orm"
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
