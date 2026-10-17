import type {
	deleteAccount as deleteAccountEndpoint,
	getMe,
	getUsage,
} from "@klipstack/api-contract"
import { db, eq, user as userTable } from "@klipstack/db"
import { deleteAccount } from "~/commands/account.server"
import { ai } from "~/lib/ai.server"
import { hasFeature } from "~/lib/features.server"
import { usageOf } from "~/lib/limits.server"
import { hasTopics, topicsOffered } from "~/services/topics.server"
import { oauthClientName, signedInAt } from "../auth.server"
import { unauthorized } from "../errors.server"
import type { Handler } from "../handler.server"

export const me: Handler<typeof getMe> = async ({ principal }) => {
	const [user] = await db
		.select({ id: userTable.id, name: userTable.name, email: userTable.email })
		.from(userTable)
		.where(eq(userTable.id, principal.userId))
		.limit(1)
	if (!user) throw unauthorized("This account no longer exists.", true)
	return {
		...user,
		access: principal.access,
		via: principal.via,
		client: principal.clientId
			? { id: principal.clientId, name: await oauthClientName(principal.clientId) }
			: null,
	}
}

/** Settings' Usage: the caps the account has, AI's and topics' only when it uses them. */
export const usage: Handler<typeof getUsage> = async ({ userId }) => {
	const [counts, aiOn, offered, topicsOn] = await Promise.all([
		usageOf(userId),
		hasFeature(userId, "ai"),
		topicsOffered(userId),
		hasTopics(userId),
	])
	return {
		saves: counts.saves,
		storage: counts.storage,
		feeds: counts.feeds,
		editions: counts.editions,
		ai: ai.available && aiOn ? counts.ai : null,
		topicSorts: offered && topicsOn ? counts.topicSorts : null,
		resetsAt: counts.resetsAt.toISOString(),
	}
}

/**
 * Deletes the account, as Settings on the web does: the same command, with the time the user
 * signed in to get this token as the recent sign-in it needs. The router lets only our own apps
 * here (`ACCOUNT_DELETION_CLIENTS`).
 */
export const remove: Handler<typeof deleteAccountEndpoint> = async ({ principal, body }) => {
	await deleteAccount(principal.userId, {
		confirmEmail: body.confirmEmail,
		signedInAt: await signedInAt(principal),
	})
}
