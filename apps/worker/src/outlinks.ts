import { documentOutlinks, eq, type Tx } from "@klipstack/db"
import { outlinkHashes } from "@klipstack/extract"

/**
 * Rewrite an article's outlink rows from its extracted HTML. A link to the article's own address
 * is left out: it connects nothing.
 */
export async function syncOutlinks(
	tx: Tx,
	doc: { id: string; userId: string; urlHash: string },
	html: string,
	baseUrl: string,
): Promise<number> {
	const hashes = outlinkHashes(html, baseUrl).filter((hash) => hash !== doc.urlHash)
	await tx.delete(documentOutlinks).where(eq(documentOutlinks.documentId, doc.id))
	if (hashes.length)
		await tx
			.insert(documentOutlinks)
			.values(hashes.map((urlHash) => ({ documentId: doc.id, userId: doc.userId, urlHash })))
	return hashes.length
}
