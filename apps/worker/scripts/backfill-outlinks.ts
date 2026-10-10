// Fills document_outlinks for articles extracted before the table existed. Safe to run again: each
// article's rows are rewritten. Usage: pnpm --filter @klipstack/worker outlinks
import {
	and,
	asc,
	db,
	documentRaw,
	documents,
	documentVersions,
	eq,
	gt,
	isNotNull,
	loadEnv,
	pool,
} from "@klipstack/db"
import { syncOutlinks } from "../src/outlinks"

loadEnv()

const BATCH = 200
let after = "00000000-0000-0000-0000-000000000000"
let articles = 0
let links = 0
for (;;) {
	const rows = await db
		.select({
			id: documents.id,
			userId: documents.userId,
			urlHash: documents.urlHash,
			sourceUrl: documents.sourceUrl,
			finalUrl: documentRaw.finalUrl,
			html: documentVersions.html,
		})
		.from(documents)
		.innerJoin(documentVersions, eq(documentVersions.id, documents.currentVersionId))
		.leftJoin(documentRaw, eq(documentRaw.id, documentVersions.rawId))
		.where(and(isNotNull(documents.currentVersionId), gt(documents.id, after)))
		.orderBy(asc(documents.id))
		.limit(BATCH)
	if (rows.length === 0) break
	for (const row of rows) {
		links += await db.transaction((tx) =>
			syncOutlinks(tx, row, row.html, row.finalUrl ?? row.sourceUrl),
		)
	}
	articles += rows.length
	after = rows.at(-1)!.id
}
console.log(`outlinks: ${links} links from ${articles} articles`)
await pool.end()
