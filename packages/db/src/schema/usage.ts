import { date, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core"
import { user } from "./auth"

/**
 * How often a reader used parts of topics, for admins: numbers only, no article, title or topic.
 * Clicks (filtering the library or a search by a topic, opening a topic, following "Read next",
 * choosing a topic on Home) and the reader's corrections (taking an article out of a topic,
 * renaming or removing a topic).
 */
export const topicUseMetrics = [
	"topic_filter_library",
	"topic_filter_search",
	"topic_opened",
	"topic_next",
	"topic_home",
	"topic_taken_out",
	"topic_renamed",
	"topic_removed",
] as const
export type TopicUseMetric = (typeof topicUseMetrics)[number]

/**
 * What a monthly cap counts (`shares`: new public addresses for highlights; `topics`: Haiku's work on an account's topics, proposing, growing
 * and reviewing them; `topic_sorts`: articles Jev sorted into them, first sorts and re-sorts
 * alike), and for admins: `refused`, how often a cap, any of them, refused the account (who keeps
 * hitting caps); `ai_spend`, what its AI answers cost, and `topic_spend`, what its topics cost
 * (Haiku and Jev), each estimated in millionths of a US dollar when paid for (what AI costs,
 * whatever is deleted later); and `topicUseMetrics`.
 */
export const usageMetrics = [
	"saves",
	"editions",
	"shares",
	"ai",
	"refused",
	"ai_spend",
	"topics",
	"topic_sorts",
	"topic_spend",
	...topicUseMetrics,
] as const
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
