import { eq } from "drizzle-orm"
import type { Tx } from "./client"
import { savedSearches } from "./schema"

/**
 * Rewrites a user's saved queries in the caller's transaction: what a query names changed (a tag
 * renamed, a topic merged), and the searches follow it. `rewrite` gets each query as stored and
 * returns it, changed or not. The web app and the worker both change what queries name.
 */
export async function rewriteSavedQueries(
	tx: Tx,
	userId: string,
	rewrite: (query: string) => string,
): Promise<void> {
	const rows = await tx
		.select({ id: savedSearches.id, query: savedSearches.query })
		.from(savedSearches)
		.where(eq(savedSearches.userId, userId))
	for (const row of rows) {
		const query = rewrite(row.query)
		if (query !== row.query)
			await tx.update(savedSearches).set({ query }).where(eq(savedSearches.id, row.id))
	}
}
