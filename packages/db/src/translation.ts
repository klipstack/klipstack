import { eq, sql } from "drizzle-orm"
import type { Tx } from "./client"
import { documents, documentVersions } from "./schema"
import { storedSearchVector } from "./search"

/** Words a minute, as extraction counts reading time (`@klipstack/extract`). */
const WORDS_PER_MINUTE = 230

/**
 * Makes a version of the article the one it shows: a translation, or the original back. The
 * article takes the version's title (unless the reader set their own), description, language and
 * length, and its search holds the original as well while a translation shows. `original` is the
 * original version the translation came from, or null when the original is the one shown.
 *
 * The version shown so far keeps what it showed first: versions extracted before they kept their
 * own title (they have none) get the article's now, before it changes.
 */
export async function showVersion(
	tx: Tx,
	documentId: string,
	versionId: string,
	original: string | null,
) {
	// Column names from this file only; the id is a parameter.
	const v = (column: "title" | "description" | "language" | "word_count") =>
		sql`(select ${sql.raw(`v.${column}`)} from document_versions v where v.id = ${versionId})`
	await tx
		.update(documentVersions)
		.set({
			title: sql`coalesce(${documentVersions.title}, ${documents.title})`,
			description: sql`case when ${documentVersions.title} is null then ${documents.description} else ${documentVersions.description} end`,
			language: sql`coalesce(${documentVersions.language}, ${documents.language})`,
			wordCount: sql`coalesce(${documentVersions.wordCount}, ${documents.wordCount})`,
		})
		.from(documents)
		.where(
			sql`${documentVersions.id} = ${documents.currentVersionId} and ${documents.id} = ${documentId}`,
		)
	await tx
		.update(documents)
		.set({
			currentVersionId: versionId,
			originalVersionId: original,
			title: sql`case when ${documents.titleEdited} then ${documents.title} else coalesce(${v("title")}, ${documents.title}) end`,
			description: v("description"),
			language: v("language"),
			wordCount: sql`coalesce(${v("word_count")}, ${documents.wordCount})`,
			readingMinutes: sql`greatest(1, round(coalesce(${v("word_count")}, ${documents.wordCount}, 0) / ${sql.raw(`${WORDS_PER_MINUTE}.0`)}))::int`,
		})
		.where(eq(documents.id, documentId))
	await tx
		.update(documents)
		.set({ search: storedSearchVector(documents) })
		.where(eq(documents.id, documentId))
}
