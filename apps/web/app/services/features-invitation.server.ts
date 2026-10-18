import { and, db, type Db, eq, sql, type Tx, user as userTable } from "@klipstack/db"
import { topicModels } from "~/lib/ai.server"
import { hasFeature } from "~/lib/features.server"
import { resolvePrefs } from "~/lib/prefs"
import { hasTopics } from "./topics.server"

/**
 * The sidebar's invitation to Settings → Features, while every feature the account can turn on is
 * still off: `topics` when topics are among them. Null once it is over
 * (`markFeaturesInvitationEnded`).
 */
export async function featuresInvitation(userId: string): Promise<{ topics: boolean } | null> {
	const [row] = await db
		.select({ prefs: userTable.prefs })
		.from(userTable)
		.where(eq(userTable.id, userId))
	if (!row) return null
	const prefs = resolvePrefs(row.prefs)
	if (prefs.featuresInvitationEndedAt || prefs.editions === "on" || prefs.feeds === "on")
		return null
	if (await hasTopics(userId)) return null
	return { topics: topicModels.available && (await hasFeature(userId, "topics")) }
}

/**
 * The invitation is over, for good: closed, Settings → Features opened, or a feature turned on.
 * Keeps the first time it ended.
 */
export async function markFeaturesInvitationEnded(tx: Db | Tx, userId: string): Promise<void> {
	await tx
		.update(userTable)
		.set({
			prefs: sql`${userTable.prefs} || jsonb_build_object('featuresInvitationEndedAt', ${new Date().toISOString()}::text)`,
		})
		.where(
			and(eq(userTable.id, userId), sql`not (${userTable.prefs} ? 'featuresInvitationEndedAt')`),
		)
}
