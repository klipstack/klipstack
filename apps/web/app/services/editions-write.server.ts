/**
 * The writers of editions: row changes, each in the transaction the caller opened (`tx`). The rules
 * (limits, ownership, refusals) are in `commands/editions-actions.server.ts`; reads are in
 * `editions.server.ts`.
 *
 * Most writers find their rows by id alone: each says which of the user's rows its caller must have
 * locked or checked first, the edition (`lockEdition`) or the article. Those that touch library
 * data also go by the user's id.
 *
 * Every change takes the edition's row lock first, and sets `updatedAt` in database time (`touch`).
 * So a publish sees all of an edit or none of it, and "unpublished changes" never misses one.
 */
import {
	and,
	type Db,
	documents,
	type EditionItem,
	editionItems,
	editions,
	eq,
	gt,
	gte,
	inArray,
	isNotNull,
	isNull,
	sql,
	type Tx,
	user as userTable,
} from "@klipstack/db"
import { NUDGE } from "~/lib/editions"
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

/**
 * A working-copy change: the public page is now out of date.
 * The caller locked the user's edition first (`lockEdition`).
 */
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
 * The caller locked the user's draft first (`currentDraft`).
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
	let position = await nextPosition(tx, draft.id)
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
 * The caller locked the user's draft first (`currentDraft`).
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
 * It locks the user's draft itself (`draftOfChange`): the caller only passes the user's own change.
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
		const live = documentId ? await articleStillThere(tx, userId, documentId) : null
		const copy = item ? null : live ? copies.get(live) : undefined
		if (!item && !copy) continue
		const position = await makeRoom(tx, draft.id, was)
		if (item) await tx.insert(editionItems).values({ ...item, position, documentId: live })
		else await insertCopy(tx, draft, live!, copy!, position)
	}
	await closeUp(tx, draft.id)
	await touch(tx, draft.id)
}

/** The position after the edition's last item: 0 for none. */
async function nextPosition(tx: Tx, editionId: string): Promise<number> {
	const [last] = await tx
		.select({ next: sql<number>`coalesce(max(${editionItems.position}) + 1, 0)::int` })
		.from(editionItems)
		.where(eq(editionItems.editionId, editionId))
	return last!.next
}

/**
 * Room for an item back at `position`, or at the end when the edition is shorter now: the items
 * from there move down one. The position it made.
 */
async function makeRoom(tx: Tx, editionId: string, position: number): Promise<number> {
	const at = Math.min(position, await nextPosition(tx, editionId))
	await tx
		.update(editionItems)
		.set({ position: sql`${editionItems.position} + 1` })
		.where(and(eq(editionItems.editionId, editionId), gte(editionItems.position, at)))
	return at
}

/** The user's article, by id, if it was not deleted for good: in the trash counts. */
async function articleStillThere(
	tx: Tx,
	userId: string,
	documentId: string,
): Promise<string | null> {
	const [live] = await tx
		.select({ id: documents.id })
		.from(documents)
		.where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
	return live?.id ?? null
}

/**
 * A copy of the article at the end of the edition.
 * The caller locked the user's edition first (`lockEdition`).
 */
export async function appendItem(
	tx: Tx,
	editionId: string,
	documentId: string,
	copy: ItemCopy,
): Promise<EditionItem> {
	const [item] = await tx
		.insert(editionItems)
		.values({ ...copy, editionId, documentId, position: await nextPosition(tx, editionId) })
		.returning()
	return item!
}

/**
 * Marks the user's article for the next edition, unless it is marked already.
 * By the user's id as well; the caller locked the user's edition first (`lockEdition`).
 */
export async function markArticle(tx: Tx, userId: string, documentId: string) {
	await tx
		.update(documents)
		.set({ shortlistedAt: sql`coalesce(${documents.shortlistedAt}, now())` })
		.where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
}

/**
 * Changes an item's fields. The item as it is now.
 * The caller locked the user's edition first and found the item in it (`lockEdition`, `findItem`).
 */
export async function writeItem(
	tx: Tx,
	itemId: string,
	values: Partial<typeof editionItems.$inferInsert>,
): Promise<EditionItem> {
	const [row] = await tx
		.update(editionItems)
		.set(values)
		.where(eq(editionItems.id, itemId))
		.returning()
	return row!
}

/**
 * Swaps two items' places. One statement: the unique constraint on positions is deferrable, so it
 * holds after the swap.
 * The caller locked the user's edition first and found both items in it (`lockEdition`).
 */
export async function swapItems(
	tx: Tx,
	item: Pick<EditionItem, "id" | "position">,
	other: { id: string; position: number },
) {
	await tx
		.update(editionItems)
		.set({
			position: sql`case when ${editionItems.id} = ${item.id} then ${other.position}::int else ${item.position}::int end`,
		})
		.where(inArray(editionItems.id, [item.id, other.id]))
}

/**
 * Deletes the edition's item, and the rest close up. The item as it was; null without one.
 * The caller locked the user's edition first (`lockEdition`).
 */
export async function deleteItem(
	tx: Tx,
	editionId: string,
	itemId: string,
): Promise<EditionItem | null> {
	const [item] = await tx
		.delete(editionItems)
		.where(and(eq(editionItems.id, itemId), eq(editionItems.editionId, editionId)))
		.returning()
	if (!item) return null
	await tx
		.update(editionItems)
		.set({ position: sql`${editionItems.position} - 1` })
		.where(and(eq(editionItems.editionId, editionId), gt(editionItems.position, item.position)))
	return item
}

/**
 * Takes the article's mark for the next edition off. The mark it had, in Postgres' own text.
 * By the user's id as well; the caller locked the user's edition first (`lockEdition`).
 */
export async function takeMark(tx: Tx, userId: string, documentId: string): Promise<string | null> {
	const article = and(eq(documents.id, documentId), eq(documents.userId, userId))
	const [doc] = await tx
		.select({ shortlistedAt: sql<string | null>`${documents.shortlistedAt}::text` })
		.from(documents)
		.where(article)
		.for("update")
	const shortlistedAt = doc?.shortlistedAt ?? null
	if (shortlistedAt) await tx.update(documents).set({ shortlistedAt: null }).where(article)
	return shortlistedAt
}

/**
 * A removed item back in the edition, as it was, at its place (`makeRoom`). An article deleted
 * for good meanwhile leaves it without one, as deleting does; else the article gets back the mark
 * it had (Postgres' text), unless it has one again.
 * The caller locked the user's edition first, and checked the item was one of it (`lockEdition`).
 */
export async function reinsertItem(
	tx: Tx,
	userId: string,
	item: EditionItem,
	shortlistedAt: string | null,
) {
	const position = await makeRoom(tx, item.editionId, item.position)
	const live = item.documentId ? await articleStillThere(tx, userId, item.documentId) : null
	await tx.insert(editionItems).values({ ...item, position, documentId: live })
	if (live && shortlistedAt)
		await tx
			.update(documents)
			.set({ shortlistedAt: sql`${shortlistedAt}::timestamptz` })
			.where(and(eq(documents.id, live), isNull(documents.shortlistedAt)))
}

/**
 * A draft with no title and no articles, in this time zone and language.
 * The edition is the user's: nothing to check first.
 */
export async function insertEdition(
	q: Db | Tx,
	userId: string,
	input: { locale: string; timeZone: string },
): Promise<EditionRow> {
	const [row] = await q
		.insert(editions)
		.values({ userId, locale: input.locale, timeZone: input.timeZone })
		.returning(editionColumns)
	return row!
}

/**
 * The edition's title, intro, language and cover, as edited now. The edition as it is now.
 * The caller locked the user's edition first (`lockEdition`).
 */
export async function writeEdition(
	tx: Tx,
	id: string,
	fields: Pick<EditionRow, "title" | "intro" | "locale" | "cover">,
): Promise<EditionRow> {
	const [row] = await tx
		.update(editions)
		.set({ ...fields, updatedAt: EDITED })
		.where(eq(editions.id, id))
		.returning(editionColumns)
	return row!
}

/**
 * "Not now" on the nudge for a new edition: none until `NUDGE.snoozeDays` from now.
 * By the user's id: only the signed-in user's own preference.
 */
export async function writeNudgeSnooze(q: Db | Tx, userId: string) {
	await q
		.update(userTable)
		.set({
			prefs: sql`${userTable.prefs} || jsonb_build_object('editionsNudgeAfter', to_char(
				(now() + make_interval(days => ${NUDGE.snoozeDays})) at time zone 'UTC',
				'YYYY-MM-DD"T"HH24:MI:SS"Z"'
			))`,
		})
		.where(eq(userTable.id, userId))
}

/**
 * The article's note for editions; null for none.
 * By the user's id as well; the caller locked the user's live article first (`lockArticleNotes`).
 */
export async function writeArticleEditionNote(
	tx: Tx,
	userId: string,
	documentId: string,
	note: string | null,
) {
	await tx
		.update(documents)
		.set({ editionNote: note })
		.where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
}

/**
 * The drafts' items of the article whose note is still `before` become `after`. The ids of the
 * drafts it changed, once or more.
 * The caller locked the user's drafts first (`lockDraftsWith`), and passes only their ids.
 */
export async function rewriteDraftNotes(
	tx: Tx,
	draftIds: string[],
	documentId: string,
	before: { note: string | null; included: boolean },
	after: { note: string | null; includeNote: boolean },
): Promise<string[]> {
	const changed = await tx
		.update(editionItems)
		.set(after)
		.where(
			and(
				inArray(editionItems.editionId, draftIds),
				eq(editionItems.documentId, documentId),
				before.note === null ? isNull(editionItems.note) : eq(editionItems.note, before.note),
				eq(editionItems.includeNote, before.included),
			),
		)
		.returning({ editionId: editionItems.editionId })
	return changed.map((row) => row.editionId)
}

/**
 * The page written: `snapshot` becomes what the public page shows, and it is up again. The first
 * time sets `publishedAt`, later ones `republishedAt`.
 * The caller locked the user's edition first (`lockEdition`).
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

/**
 * The public page up again, as it was last written.
 * The caller locked the user's edition first (`lockEdition`).
 */
export async function clearUnpublished(tx: Tx, id: string): Promise<EditionRow> {
	const [row] = await tx
		.update(editions)
		.set({ unpublishedAt: null })
		.where(eq(editions.id, id))
		.returning(editionColumns)
	return row!
}

/**
 * The public page hidden, from now.
 * The caller locked the user's edition first (`lockEdition`).
 */
export async function markUnpublished(tx: Tx, id: string): Promise<EditionRow> {
	const [row] = await tx
		.update(editions)
		.set({ unpublishedAt: NOW })
		.where(eq(editions.id, id))
		.returning(editionColumns)
	return row!
}

/**
 * The user's articles among `documentIds` off the shortlist.
 * By the user's id as well; the caller locked the user's edition first (`lockEdition`).
 */
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

/**
 * Deletes the user's edition, and its items with it. False when the user has no such edition.
 * By the user's id: refuses another user's edition by finding none (`owned`).
 */
export async function deleteEditionRow(q: Db | Tx, userId: string, id: string): Promise<boolean> {
	const gone = await q.delete(editions).where(owned(userId, id)).returning({ id: editions.id })
	return gone.length > 0
}
