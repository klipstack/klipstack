/**
 * The writers of editions: row changes, each in the transaction the caller opened (`tx`). The rules
 * (limits, ownership, refusals) are in `commands/editions.server.ts`; reads are in
 * `editions.server.ts`.
 *
 * Every change takes the edition's row lock first, and sets `updatedAt` in database time (`touch`).
 * So a publish sees all of an edit or none of it, and "unpublished changes" never misses one.
 */
import {
	and,
	type Db,
	documents,
	editionItems,
	editions,
	eq,
	gte,
	inArray,
	isNotNull,
	sql,
	type Tx,
} from "@klipstack/db"
import {
	type DraftChange,
	type DraftCopies,
	draftOfChange,
	editionColumns,
	type EditionRow,
	type EditionSnapshot,
	type ItemCopy,
	owned,
} from "./editions.server"

/** Database time, to the millisecond: JavaScript compares these dates, and has no more. */
export const NOW = sql`date_trunc('milliseconds', clock_timestamp())`
/** An edit's time: after the last publish, however soon after it. */
export const EDITED = sql`greatest(${NOW}, coalesce(${editions.republishedAt}, ${editions.publishedAt}) + interval '1 millisecond')`
/** A publish's time: not before the last edit, which it includes. */
export const WRITTEN = sql`greatest(${NOW}, ${editions.updatedAt})`

/** A working-copy change: the public page is now out of date. */
export async function touch(tx: Tx, id: string) {
	await tx.update(editions).set({ updatedAt: EDITED }).where(eq(editions.id, id))
}

/** The day the article was last finished, in the edition's time zone, as the transaction sees it. */
const readOnIn = (documentId: string, timeZone: string) => sql<string | null>`(
	select coalesce(
		(
			select to_char(max(c.completed_at) at time zone ${timeZone}, 'YYYY-MM-DD')
			from reading_completions c where c.document_id = d.id
		),
		to_char(d.read_at at time zone ${timeZone}, 'YYYY-MM-DD')
	)
	from documents d where d.id = ${documentId}
)::date`

/** Inserts a copy at `position`, its reading day as the transaction sees it. The item's id. */
async function insertCopy(
	tx: Tx,
	draft: EditionRow,
	documentId: string,
	copy: ItemCopy,
	position: number,
): Promise<string> {
	const [item] = await tx
		.insert(editionItems)
		.values({
			...copy,
			editionId: draft.id,
			documentId,
			position,
			readOn: readOnIn(documentId, draft.timeZone),
		})
		.returning({ id: editionItems.id })
	return item!.id
}

/**
 * Marking, in the draft in progress (`currentDraft`, locked by the caller first): each article not
 * in it yet goes to the end, from `copies` (`draftCopies`). One without a copy stays out. The
 * articles it added.
 */
export async function addToDraft(
	tx: Tx,
	draft: EditionRow,
	documentIds: string[],
	copies: DraftCopies,
): Promise<{ documentIds: string[]; change: DraftChange }> {
	const change: DraftChange = { editionId: draft.id, added: [], removed: [] }
	const wanted = documentIds.filter((id) => copies.has(id))
	if (wanted.length === 0) return { documentIds: [], change }
	const taken = await tx
		.select({ documentId: editionItems.documentId })
		.from(editionItems)
		.where(and(eq(editionItems.editionId, draft.id), inArray(editionItems.documentId, wanted)))
	const skip = new Set(taken.map((row) => row.documentId))
	const [last] = await tx
		.select({ next: sql<number>`coalesce(max(${editionItems.position}) + 1, 0)::int` })
		.from(editionItems)
		.where(eq(editionItems.editionId, draft.id))
	let position = last!.next
	const added: string[] = []
	for (const documentId of wanted) {
		if (skip.has(documentId)) continue
		change.added.push(await insertCopy(tx, draft, documentId, copies.get(documentId)!, position++))
		added.push(documentId)
	}
	if (added.length > 0) await touch(tx, draft.id)
	return { documentIds: added, change }
}

/**
 * How much of the removed items an undo carries, in characters of JSON. The API takes undo tokens
 * of up to 64 KiB, base64 makes a third more, and the rest of the record needs room too.
 */
const REMOVED_BUDGET = 32_000

/**
 * Unmarking, in the draft in progress (locked by the caller first): the articles' items go, and the
 * rest close up. The articles it took out.
 */
export async function removeFromDraft(
	tx: Tx,
	draft: EditionRow,
	documentIds: string[],
): Promise<{ documentIds: string[]; change: DraftChange }> {
	const change: DraftChange = { editionId: draft.id, added: [], removed: [], recopy: [] }
	if (documentIds.length === 0) return { documentIds: [], change }
	const removed = await tx
		.delete(editionItems)
		.where(and(eq(editionItems.editionId, draft.id), inArray(editionItems.documentId, documentIds)))
		.returning()
	if (removed.length === 0) return { documentIds: [], change }
	// As they were, while they fit; past that, undo copies the article again.
	let size = 0
	for (const item of removed.sort((a, b) => a.position - b.position)) {
		size += JSON.stringify(item).length
		if (size <= REMOVED_BUDGET) change.removed.push(item)
		else change.recopy!.push({ documentId: item.documentId!, position: item.position })
	}
	await closeUp(tx, draft.id)
	await touch(tx, draft.id)
	return { documentIds: removed.flatMap((item) => item.documentId ?? []), change }
}

/** Positions 0, 1, 2… in their order. One statement: the unique constraint is deferrable. */
async function closeUp(tx: Tx, editionId: string) {
	await tx.execute(sql`
		update edition_items i set position = o.position
		from (
			select id, (row_number() over (order by position) - 1)::int as position
			from edition_items where edition_id = ${editionId}
		) o
		where i.id = o.id and i.position <> o.position
	`)
}

/**
 * Undo of `addToDraft` or `removeFromDraft`: the added items out, the removed ones back where they
 * were (`copies`, from `draftCopies`, for those too big to carry). Only while the edition is still
 * the user's draft; an article in it again is left as it is.
 */
export async function revertDraftChange(
	tx: Tx,
	userId: string,
	change: DraftChange,
	copies: DraftCopies,
) {
	const draft = await draftOfChange(tx, userId, change, true)
	if (!draft) return
	if (change.added.length > 0)
		await tx
			.delete(editionItems)
			.where(and(eq(editionItems.editionId, draft.id), inArray(editionItems.id, change.added)))
	const back = [
		...change.removed
			.filter((item) => item.editionId === draft.id)
			.map((item) => ({ documentId: item.documentId, position: item.position, item })),
		...(change.recopy ?? []).map((entry) => ({ ...entry, item: null })),
	].sort((a, b) => a.position - b.position)
	for (const { documentId, position: was, item } of back) {
		const [taken] = await tx
			.select({ id: editionItems.id })
			.from(editionItems)
			.where(
				and(
					eq(editionItems.editionId, draft.id),
					documentId ? eq(editionItems.documentId, documentId) : eq(editionItems.id, item!.id),
				),
			)
		if (taken) continue
		// An article deleted for good meanwhile leaves the item without one, as deleting does.
		const [live] = documentId
			? await tx
					.select({ id: documents.id })
					.from(documents)
					.where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
			: []
		const copy = item ? null : live ? copies.get(live.id) : undefined
		if (!item && !copy) continue
		const [last] = await tx
			.select({ next: sql<number>`coalesce(max(${editionItems.position}) + 1, 0)::int` })
			.from(editionItems)
			.where(eq(editionItems.editionId, draft.id))
		const position = Math.min(was, last!.next)
		await tx
			.update(editionItems)
			.set({ position: sql`${editionItems.position} + 1` })
			.where(and(eq(editionItems.editionId, draft.id), gte(editionItems.position, position)))
		if (item)
			await tx.insert(editionItems).values({ ...item, position, documentId: live?.id ?? null })
		else await insertCopy(tx, draft, live!.id, copy!, position)
	}
	await closeUp(tx, draft.id)
	await touch(tx, draft.id)
}

/**
 * The page written: `snapshot` becomes what the public page shows, and it is up again. The first
 * time sets `publishedAt`, later ones `republishedAt`.
 */
export async function writeSnapshot(
	tx: Tx,
	edition: Pick<EditionRow, "id" | "publishedAt">,
	snapshot: EditionSnapshot,
): Promise<EditionRow> {
	const [row] = await tx
		.update(editions)
		.set({
			published: snapshot,
			publishedAt: edition.publishedAt ?? WRITTEN,
			republishedAt: edition.publishedAt ? WRITTEN : null,
			unpublishedAt: null,
		})
		.where(eq(editions.id, edition.id))
		.returning(editionColumns)
	return row!
}

/** The public page up again, as it was last written. */
export async function clearUnpublished(tx: Tx, id: string): Promise<EditionRow> {
	const [row] = await tx
		.update(editions)
		.set({ unpublishedAt: null })
		.where(eq(editions.id, id))
		.returning(editionColumns)
	return row!
}

/** The public page hidden, from now. */
export async function markUnpublished(tx: Tx, id: string): Promise<EditionRow> {
	const [row] = await tx
		.update(editions)
		.set({ unpublishedAt: NOW })
		.where(eq(editions.id, id))
		.returning(editionColumns)
	return row!
}

/** The user's articles among `documentIds` off the shortlist. */
export async function unmarkArticles(tx: Tx, userId: string, documentIds: string[]) {
	if (documentIds.length === 0) return
	await tx
		.update(documents)
		.set({ shortlistedAt: null })
		.where(
			and(
				eq(documents.userId, userId),
				inArray(documents.id, documentIds),
				isNotNull(documents.shortlistedAt),
			),
		)
}

/** Deletes the user's edition, and its items with it. False when the user has no such edition. */
export async function deleteEditionRow(q: Db | Tx, userId: string, id: string): Promise<boolean> {
	const gone = await q.delete(editions).where(owned(userId, id)).returning({ id: editions.id })
	return gone.length > 0
}
