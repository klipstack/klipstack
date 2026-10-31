import { assets, db, dbTimeouts, eq, sql, type Tx, user as userTable } from "@klipstack/db"
import { getStorage } from "@klipstack/storage"

/**
 * Delete a user and everything they own. Rows cascade from `user`; stored objects are removed
 * best-effort first (a failure there must not keep the account alive). `alongside` runs in the
 * deletion's transaction: the operator CLI records its audit event there.
 */
export async function deleteAccount(
	userId: string,
	alongside?: (tx: Tx) => Promise<void>,
): Promise<void> {
	const storage = getStorage()
	const owned = await db
		.select({ key: assets.storageKey })
		.from(assets)
		.where(eq(assets.userId, userId))
	await Promise.allSettled(owned.map((a) => storage.delete(a.key)))
	// Apple asks for the person's Sign in with Apple to be revoked with the account; its token goes
	// with the rows. Loaded here, not at the top: the operator CLI's image check loads this module
	// without the server's environment, which apple-tokens.server.ts reads (Dockerfile).
	const { revokeAppleSignIn } = await import("../lib/apple-tokens.server")
	await revokeAppleSignIn(userId)
	await db.transaction(async (tx) => {
		// One statement deletes everything the account owns, which on a large account outlasts a web
		// request's limit; failing here would leave the account without its files. The worker's limit
		// instead, for this transaction only.
		const { statementMs } = dbTimeouts("worker")
		await tx.execute(sql.raw(`set local statement_timeout = ${statementMs}`))
		await tx.delete(userTable).where(eq(userTable.id, userId))
		await alongside?.(tx)
	})
}

/** When the account agreed that its questions go to the AI provider; null when it has not. */
export async function aiConsentedAt(userId: string): Promise<string | null> {
	const [row] = await db
		.select({ at: sql<string | null>`${userTable.prefs}->>'aiConsentAt'` })
		.from(userTable)
		.where(eq(userTable.id, userId))
	return row?.at ?? null
}
