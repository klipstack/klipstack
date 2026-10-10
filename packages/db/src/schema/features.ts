import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core"
import { user } from "./auth"

/**
 * Features still in testing, each turned on for chosen accounts. The name is the flag's whole
 * definition: adding one needs no migration. Remove a flag when its feature reaches everyone.
 * `ai`: questions about a passage, answered in the margin.
 */
export const featureFlags = ["ai"] as const satisfies readonly string[]
export type FeatureFlag = (typeof featureFlags)[number]

export function isFeatureFlag(value: unknown): value is FeatureFlag {
	return typeof value === "string" && (featureFlags as readonly string[]).includes(value)
}

/** The features turned on for an account: a row means on. Rows of removed flags are ignored. */
export const userFeatures = pgTable(
	"user_features",
	{
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		feature: text("feature").$type<FeatureFlag>().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.userId, t.feature] })],
)
