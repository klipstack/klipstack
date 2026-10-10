import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core"
import { user } from "./auth"
import { oauthClient } from "./oauth"

/** A durable authorization generation. Deleting it permanently invalidates the old grant. */
export const oauthGrants = pgTable(
	"oauth_grants",
	{
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		clientId: text("client_id")
			.notNull()
			.references(() => oauthClient.clientId, { onDelete: "cascade" }),
		generation: text("generation").notNull(),
	},
	(t) => [primaryKey({ columns: [t.userId, t.clientId] })],
)

/** Shared fixed-window counters; account identifiers are hashed before storage. */
export const authLimits = pgTable(
	"auth_limits",
	{
		key: text("key").primaryKey(),
		hits: integer("hits").notNull(),
		resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
	},
	(t) => [index("auth_limits_reset_idx").on(t.resetAt)],
)
