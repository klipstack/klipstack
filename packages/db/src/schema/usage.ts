import { date, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core"
import { user } from "./auth"

/**
 * What a monthly cap counts, and `refused`: how often a cap, any of them, refused the account. That
 * one is for admins, who look at who keeps hitting caps.
 */
export const usageMetrics = ["saves", "editions", "ai", "refused"] as const
export type UsageMetric = (typeof usageMetrics)[number]

/**
 * How many of a thing an account did in a calendar month (UTC). Counted when it happens, not
 * from the rows it made: deleting an article does not give its save back.
 */
export const usageCounts = pgTable(
	"usage_counts",
	{
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		metric: text("metric", { enum: usageMetrics }).notNull(),
		/** The month's first day. */
		month: date("month", { mode: "string" }).notNull(),
		count: integer("count").notNull().default(0),
	},
	(t) => [primaryKey({ columns: [t.userId, t.metric, t.month] })],
)
