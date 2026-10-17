import { db, TransactionRollbackError, type Tx } from "@klipstack/db"

/**
 * Runs `fn` in a transaction that sees the database as it was at its first query, plus its own
 * writes, then rolls it all back. For a test of a query over every account, such as a total or a
 * cap: the other test files write to the same database at the same time, and here their rows
 * neither come nor go mid-test, while the rows this test adds never reach them.
 */
export async function inSnapshot<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
	let result: { value: T } | undefined
	try {
		await db.transaction(
			async (tx) => {
				result = { value: await fn(tx) }
				tx.rollback()
			},
			{ isolationLevel: "repeatable read" },
		)
	} catch (error) {
		if (!(error instanceof TransactionRollbackError) || !result) throw error
	}
	return result!.value
}
