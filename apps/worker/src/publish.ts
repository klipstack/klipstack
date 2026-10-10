import {
	desc,
	type Document,
	documentRaw,
	documentSearchVector,
	documents,
	documentVersions,
	eq,
	sql,
	type Tx,
} from "@klipstack/db"
import type { ExtractedArticle } from "@klipstack/extract"
import { syncOutlinks } from "./outlinks"

/** Publish a capture through the same transaction for the worker and local demo replay. */
export async function publishExtraction(
	tx: Tx,
	doc: Pick<Document, "id" | "userId" | "urlHash">,
	rawId: string,
	article: ExtractedArticle,
	url: string,
): Promise<string | null> {
	// The document row first, as admission and image publication take it: version numbers
	// and the current version change one job at a time.
	const [live] = await tx
		.select({ id: documents.id })
		.from(documents)
		.where(eq(documents.id, doc.id))
		.for("update")
	if (!live) return null
	// A capture saved while this job ran was admitted its own job (this one counted as
	// running, not waiting). Publishing now could land after that job and put the older
	// capture back as the current version.
	const [newest] = await tx
		.select({ id: documentRaw.id })
		.from(documentRaw)
		.where(eq(documentRaw.documentId, doc.id))
		.orderBy(desc(documentRaw.fetchedAt))
		.limit(1)
	if (newest && newest.id !== rawId) return null

	const [row] = await tx
		.select({ max: sql<number>`coalesce(max(${documentVersions.version}), 0)` })
		.from(documentVersions)
		.where(eq(documentVersions.documentId, doc.id))
	const [version] = await tx
		.insert(documentVersions)
		.values({
			documentId: doc.id,
			rawId,
			version: Number(row?.max ?? 0) + 1,
			html: article.html,
			text: article.text,
			textHash: article.textHash,
			extractor: article.extractor.name,
			extractorVersion: article.extractor.version,
		})
		.returning({ id: documentVersions.id })
	if (!version) throw new Error("version insert returned nothing")

	await tx
		.update(documents)
		.set({
			type: article.type,
			title: sql`case when ${documents.titleEdited} then ${documents.title} else ${article.title} end`,
			author: article.author,
			siteName: article.siteName,
			description: article.description,
			language: article.language,
			wordCount: article.wordCount,
			readingMinutes: article.readingMinutes,
			publishedAt: article.publishedAt,
			leadImageUrl: article.leadImageUrl,
			// A new lead picture needs its own thumbnail: the images job makes it.
			// (No picture comes as "" or null.)
			leadImageAssetId: sql`case when coalesce(${documents.leadImageUrl}, '') <> coalesce(${article.leadImageUrl}, '') then null else ${documents.leadImageAssetId} end`,
			canonicalUrl: article.canonicalUrl,
			status: "ready",
			failureReason: null,
			currentVersionId: version.id,
			search: documentSearchVector({
				title: sql`case when ${documents.titleEdited} then ${documents.title} else ${article.title} end`,
				author: article.author,
				body: article.text,
				language: article.language,
			}),
		})
		.where(eq(documents.id, doc.id))
	// What this version links to: other articles of the library connect through it.
	await syncOutlinks(tx, doc, article.html, url)
	return version.id
}
