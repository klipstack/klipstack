import {
	and,
	db,
	documents,
	documentTags,
	eq,
	inArray,
	or,
	readingCompletions,
	sql,
	tags,
} from "@klipstack/db"
import { type DraftChange, revertDraftChange } from "./editions.server"

export const DATES = [
	"starredAt",
	"shortlistedAt",
	"archivedAt",
	"readAt",
	"firstOpenedAt",
	"lastReadAt",
	"keptAt",
] as const
export const NUMBERS = ["readingProgress", "readingPosition", "readingCycle"] as const
export type Column = (typeof DATES)[number] | (typeof NUMBERS)[number]

/**
 * An article's columns before a change, only those the change writes. Times are Postgres' own
 * text, so undo puts back the microseconds too.
 */
export type Before = { id: string } & Partial<Record<Column, string | number | null>>

/** What undoing an article change puts back. The web signs it into the toast's undo. */
export interface UndoRecord {
	docs: Before[]
	/** Reading completions the change recorded. */
	completions: string[]
	/** (article, tag) pairs the change added. */
	tagLinks: Array<{ documentId: string; tagId: string }>
	/** (article, tag) pairs the change took off. */
	removedLinks?: Array<{ documentId: string; tagId: string }>
	/** Tags the change created. */
	tags: string[]
	/** What marking or unmarking did to the draft in progress. */
	draft?: DraftChange
}

export const emptyUndo = (): UndoRecord => ({
	docs: [],
	completions: [],
	tagLinks: [],
	removedLinks: [],
	tags: [],
})

/** Puts back what an article change recorded. Returns the ids of the articles it wrote to. */
export async function revertChanges(userId: string, undo: UndoRecord): Promise<string[]> {
	return db.transaction(async (tx) => {
		const touched = new Set<string>()
		// The draft before the articles: the order every change takes its locks in.
		if (undo.draft) await revertDraftChange(tx, userId, undo.draft)
		for (const doc of undo.docs) {
			const set: Record<string, unknown> = {}
			for (const column of DATES)
				if (column in doc)
					set[column] = doc[column] === null ? null : sql`${doc[column]}::timestamptz`
			for (const column of NUMBERS) if (column in doc) set[column] = doc[column]
			if (Object.keys(set).length === 0) continue
			const rows = await tx
				.update(documents)
				.set(set)
				.where(and(eq(documents.id, doc.id), eq(documents.userId, userId)))
				.returning({ id: documents.id })
			if (rows.length > 0) touched.add(doc.id)
		}
		if (undo.completions.length > 0)
			await tx
				.delete(readingCompletions)
				.where(
					and(
						eq(readingCompletions.userId, userId),
						inArray(readingCompletions.id, undo.completions),
					),
				)
		if (undo.tagLinks.length > 0) {
			const owned = tx
				.select({ id: documents.id })
				.from(documents)
				.where(eq(documents.userId, userId))
			await tx
				.delete(documentTags)
				.where(
					and(
						inArray(documentTags.documentId, owned),
						or(
							...undo.tagLinks.map((link) =>
								and(
									eq(documentTags.documentId, link.documentId),
									eq(documentTags.tagId, link.tagId),
								),
							),
						),
					),
				)
			for (const link of undo.tagLinks) touched.add(link.documentId)
		}
		// Tags taken off go back on, on the user's articles and tags that are still there.
		if (undo.removedLinks && undo.removedLinks.length > 0) {
			const owned = await tx
				.select({ id: documents.id })
				.from(documents)
				.where(
					and(
						eq(documents.userId, userId),
						inArray(
							documents.id,
							undo.removedLinks.map((l) => l.documentId),
						),
					),
				)
			const ownedTags = await tx
				.select({ id: tags.id })
				.from(tags)
				.where(
					and(
						eq(tags.userId, userId),
						inArray(
							tags.id,
							undo.removedLinks.map((l) => l.tagId),
						),
					),
				)
			const docIds = new Set(owned.map((d) => d.id))
			const tagIds = new Set(ownedTags.map((t) => t.id))
			const links = undo.removedLinks.filter((l) => docIds.has(l.documentId) && tagIds.has(l.tagId))
			if (links.length > 0) await tx.insert(documentTags).values(links).onConflictDoNothing()
			for (const link of links) touched.add(link.documentId)
		}
		// A tag the change created goes with it, unless something has used it since.
		if (undo.tags.length > 0)
			await tx
				.delete(tags)
				.where(
					and(
						eq(tags.userId, userId),
						inArray(tags.id, undo.tags),
						sql`not exists (select 1 from ${documentTags} where ${documentTags.tagId} = ${tags.id})`,
					),
				)
		return [...touched]
	})
}
