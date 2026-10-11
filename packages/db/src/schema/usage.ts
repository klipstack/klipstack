import { date, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core"
import { user } from "./auth"

/**
 * What a monthly cap counts, and two for admins: `refused`, how often a cap, any of them, refused
 * the account (who keeps hitting caps), and `ai_spend`, what its AI answers cost, estimated in
 * millionths of a US dollar when each is paid for (what AI costs, whatever is deleted later).
 */
export const usageMetrics = ["saves", "editions", "ai", "refused", "ai_spend"] as const
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
