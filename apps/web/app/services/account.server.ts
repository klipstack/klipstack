import { assets, db, eq, type Tx, user as userTable } from "@klipstack/db"
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
	await db.transaction(async (tx) => {
		await tx.delete(userTable).where(eq(userTable.id, userId))
		await alongside?.(tx)
	})
}
