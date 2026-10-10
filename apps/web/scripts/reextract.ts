import { and, db, documents, ilike, isNull, pool } from "@klipstack/db"
import { admitExtract, stopBoss } from "@klipstack/queue"

/**
 * Re-run extraction for saved articles using their stored raw capture (no refetch).
 * Highlights re-anchor to the new version on next open.
 *
 *   tsx scripts/reextract.ts <url-substring>     re-extract matching documents
 *   tsx scripts/reextract.ts --all               re-extract everything
 */
const [arg] = process.argv.slice(2)
if (!arg) {
	console.error("usage: tsx scripts/reextract.ts <url-substring> | --all")
	process.exit(1)
}
const where =
	arg === "--all"
		? isNull(documents.deletedAt)
		: and(isNull(documents.deletedAt), ilike(documents.sourceUrl, `%${arg}%`))
const rows = await db
	.select({ id: documents.id, sourceUrl: documents.sourceUrl })
	.from(documents)
	.where(where)
let queued = 0
for (const row of rows) {
	// The same admission as saving and retrying: no second job while one waits or runs.
	const admission = await db.transaction((tx) => admitExtract(tx, row.id, "refresh"))
	if (admission.outcome === "admitted") queued++
	console.log(admission.outcome === "admitted" ? "queued" : "skipped", row.id, row.sourceUrl)
}
console.log(`${queued} of ${rows.length} document(s) queued`)
await stopBoss()
await pool.end()
