import { pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { user } from "./auth"

/**
 * An account's billing, apart from what `plan.ts` works out from the sign-up date. No row: nothing
 * special about the account. `freeUntil`, set by an admin, replaces the founding year or the trial
 * it would have: the paid plan's caps until then, at no charge, and lapsed after.
 */
export const accountBilling = pgTable("account_billing", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	freeUntil: timestamp("free_until", { withTimezone: true }),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
})
