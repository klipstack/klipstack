import { NOTE_MAX, withoutNul } from "@klipstack/api-contract/names"
import { db, type EditionCover, type EditionItem } from "@klipstack/db"
import { isLocale, supportedLanguages } from "@klipstack/i18n"
import { z } from "zod"
import { AppError, parseInput } from "~/lib/app-error"
import {
	EDITION_COVERS,
	EDITION_INTRO_MAX,
	EDITION_TITLE_MAX,
	hasUnpublishedChanges,
	includedQuotes,
	type PublishProblem,
	publishProblems,
	quoteProblem,
} from "~/lib/editions"
import { editionsOn } from "~/lib/features.server"
import { checkMayAdd, countMonthly } from "~/lib/limits.server"
import {
	appendItem,
	clearUnpublished,
	deleteEditionRow,
	deleteItem,
	insertEdition,
	markArticle,
	markUnpublished,
	reinsertItem,
	rewriteDraftNotes,
	swapItems,
	takeMark,
	touch,
	unmarkArticles,
	writeArticleEditionNote,
	writeEdition,
	writeItem,
	writeNudgeSnooze,
	writeSnapshot,
} from "~/services/editions-write.server"
import {
	currentDraft,
	authorName,
	buildSnapshot,
	checkId,
	copyItem,
	type EditionRow,
	findEdition,
	findItem,
	itemAt,
	itemExists,
	itemOfArticle,
	listItems,
	lockArticleNotes,
	lockDraftsWith,
	lockEdition,
	lockUser,
	noteLinkRewriter,
	refuse,
	shortlistNotIn,
} from "~/services/editions.server"

/**
 * The user's editions, for the web: the limits, the transactions and the refusals. A field past its
 * limit is refused with the field (`details.field`), for the editor's text. Reads are in
 * `services/editions.server.ts`, the row writes in `services/editions-write.server.ts`.
 *
 * Every change takes the edition's row lock first (`lockEdition`), and sets `updatedAt` in database
 * time (`touch`). So a publish sees all of an edit or none of it, and "unpublished changes" never
 * misses one.
 *
 * Adapters call `changeEdition` and the commands that check `mayUseEditions`; the actions below it
 * leave that to them.
 */

/** Every command here: editions are turned on for the account (Settings → Features). */
export async function mayUseEditions(userId: string) {
	if (!(await editionsOn(userId)))
		throw new AppError("forbidden", "Editions are turned off for this account.")
}

/** A field past its limit: `details.field` says which, for the editor's text. */
const invalid = (field: "title" | "intro" | "note" | "locale", message: string) =>
	new AppError("invalid_request", message, { details: { field } })

/** Form posts send CRLF. */
const lf = (text: string) => text.replace(/\r\n?/g, "\n")

/** Optional: blank is none, and the page shows its date instead. */
function cleanTitle(raw: string | null): string | null {
	const title = (raw ?? "").replace(/\s+/g, " ").trim()
	if (title.length > EDITION_TITLE_MAX || !withoutNul(title))
		throw invalid("title", `A title has up to ${EDITION_TITLE_MAX} characters, and no NUL.`)
	return title || null
}

function cleanText(raw: string | null, max: number, field: "intro" | "note") {
	const text = lf(raw ?? "").trim()
	if (text.length > max || !withoutNul(text))
		throw invalid(field, `That text has up to ${max} characters, and no NUL.`)
	return text || null
}

function checkLocale(locale: string) {
	if (!isLocale(locale)) throw invalid("locale", "That is not a language Klipstack has.")
}

const id = z.string().max(64)
const text = z.string().max(200_000)

/** What the editor posts to `/editions/:id`, and autosave to `/editions/:id/save`. */
const EditionChange = z.discriminatedUnion("intent", [
	z.object({
		intent: z.literal("update"),
		/** Blank or null for none. */
		title: z.string().max(1000).nullable().optional(),
		intro: text.nullable().optional(),
		locale: z.enum(supportedLanguages).optional(),
		cover: z.enum(EDITION_COVERS).optional(),
	}),
	z.object({ intent: z.literal("add-item"), documentId: id }),
	/** Every article of the shortlist the edition does not have yet. */
	z.object({ intent: z.literal("add-shortlist") }),
	z.object({
		intent: z.literal("update-item"),
		itemId: id,
		/** False sets the item aside: out of the public page, still in the working copy. */
		included: z.boolean().optional(),
		includeNote: z.boolean().optional(),
		note: text.nullable().optional(),
		highlights: z
			.array(
				z.object({
					highlightId: id,
					included: z.boolean().optional(),
					note: text.nullable().optional(),
				}),
			)
			.max(1000)
			.optional(),
	}),
	z.object({ intent: z.literal("move-item"), itemId: id, direction: z.enum(["up", "down"]) }),
	z.object({ intent: z.literal("remove-item"), itemId: id }),
	z.object({ intent: z.literal("refresh-item"), itemId: id }),
	z.object({ intent: z.literal("publish") }),
	z.object({ intent: z.literal("unpublish") }),
	z.object({ intent: z.literal("delete") }),
])

export type EditionChange = z.infer<typeof EditionChange>

/**
 * A draft in the reader's time zone and language, untitled, with the articles of the shortlist.
 */
export async function createEdition(userId: string, input: { locale: string; timeZone: string }) {
	await mayUseEditions(userId)
	const edition = await createEmptyEdition(userId, input)
	await addShortlist(userId, edition.id)
	return edition
}

/**
 * "Start" on `/editions`: the draft in progress, else a new one (`createEdition`). One draft at a
 * time is what the page offers; a second only comes from asking for it.
 */
export async function startEdition(userId: string, input: { locale: string; timeZone: string }) {
	await mayUseEditions(userId)
	// The user's row held while it looks, so two Starts at once make one draft.
	const { draft, created } = await db.transaction(async (tx) => {
		await lockUser(tx, userId)
		const found = await currentDraft(tx, userId)
		if (found) return { draft: found, created: false }
		checkLocale(input.locale)
		return { draft: await insertEdition(tx, userId, input), created: true }
	})
	if (created) await addShortlist(userId, draft.id)
	return draft
}

const EditionNote = z.object({ note: text.nullable() })

/**
 * What to tell an edition's readers about an article, written at its end while reading. Blank or
 * null clears it. The article's editions to come start with it included.
 */
export async function setArticleEditionNote(userId: string, documentId: string, input: unknown) {
	await mayUseEditions(userId)
	const { note } = parseInput(EditionNote, input)
	return { editionNote: await setEditionNote(userId, documentId, note) }
}

/** "Not now" on the nudge for a new edition: none for a week. */
export async function snoozeEditionNudge(userId: string) {
	await mayUseEditions(userId)
	await snoozeNudge(userId)
}

/**
 * Undo of removing an item: what `changeEdition` answered for it (`removed`), which the caller kept
 * safe from changes (the web signs it).
 */
export async function restoreEditionItem(userId: string, editionId: string, removed: RemovedItem) {
	await mayUseEditions(userId)
	return restoreItem(userId, editionId, removed)
}

/**
 * One editor action on the user's edition. `deleted` after a delete; `added`, how many articles
 * `add-shortlist` added; `removed`, what `remove-item` took away, for its undo. A publish that
 * something stands in the way of is refused (`publish_problems`, with them).
 */
export async function changeEdition(
	userId: string,
	editionId: string,
	input: unknown,
): Promise<{ deleted?: true; added?: number; removed?: RemovedItem }> {
	const change = parseInput(EditionChange, input)
	await mayUseEditions(userId)
	switch (change.intent) {
		case "update": {
			const { intent: _, ...patch } = change
			await updateEdition(userId, editionId, patch)
			break
		}
		case "add-item":
			await addItem(userId, editionId, change.documentId)
			break
		case "add-shortlist":
			return { added: await addShortlist(userId, editionId) }
		case "update-item": {
			const { intent: _, itemId, ...patch } = change
			await updateItem(userId, editionId, itemId, patch)
			break
		}
		case "move-item":
			await moveItem(userId, editionId, change.itemId, change.direction)
			break
		case "remove-item":
			return { removed: await removeItem(userId, editionId, change.itemId) }
		case "refresh-item":
			await refreshItem(userId, editionId, change.itemId)
			break
		case "publish": {
			const published = await publishEdition(userId, editionId)
			if (!published.ok)
				throw new AppError(
					"publish_problems",
					"Something keeps this edition from being published.",
					{ details: { problems: published.problems } },
				)
			break
		}
		case "unpublish":
			await unpublishEdition(userId, editionId)
			break
		case "delete":
			await deleteEdition(userId, editionId)
			return { deleted: true }
	}
	return {}
}

/** A draft with no title and no articles, in the reader's time zone and language. */
export async function createEmptyEdition(
	userId: string,
	input: { locale: string; timeZone: string },
): Promise<EditionRow> {
	checkLocale(input.locale)
	return insertEdition(db, userId, input)
}

/** Title, intro, language and cover. Unchanged values change nothing, not even `updatedAt`. */
export async function updateEdition(
	userId: string,
	id: string,
	patch: { title?: string | null; intro?: string | null; locale?: string; cover?: EditionCover },
): Promise<EditionRow> {
	const title = patch.title === undefined ? undefined : cleanTitle(patch.title)
	const intro =
		patch.intro === undefined ? undefined : cleanText(patch.intro, EDITION_INTRO_MAX, "intro")
	if (patch.locale !== undefined) checkLocale(patch.locale)
	return db.transaction(async (tx) => {
		const edition = await lockEdition(tx, userId, id)
		const next = {
			title: title === undefined ? edition.title : title,
			intro: intro === undefined ? edition.intro : intro,
			locale: patch.locale ?? edition.locale,
			cover: patch.cover ?? edition.cover,
		}
		if (
			next.title === edition.title &&
			next.intro === edition.intro &&
			next.locale === edition.locale &&
			next.cover === edition.cover
		)
			return edition
		return writeEdition(tx, id, next)
	})
}

/**
 * The article's note for editions, written while reading. Blank clears it. A draft that has the
 * article already gets it too, unless the user changed the draft's copy there: a copy still as
 * adding made it becomes what adding would make now. Published editions keep their copy, as with
 * every library change.
 */
export async function setEditionNote(
	userId: string,
	documentId: string,
	raw: string | null,
): Promise<string | null> {
	const note = cleanText(raw, NOTE_MAX, "note")
	checkId(documentId)
	return db.transaction(async (tx) => {
		// The drafts first, then the article: the order every other change takes its locks in.
		const drafts = await lockDraftsWith(tx, userId, documentId)
		const doc = await lockArticleNotes(tx, userId, documentId)
		if (!doc) throw refuse("not_found")
		if (doc.editionNote === note) return note
		await writeArticleEditionNote(tx, documentId, note)
		if (drafts.length === 0) return note
		// What adding gave an item before this change, and what it gives now (`copyItem`).
		const rewrite = await noteLinkRewriter(userId, [doc.editionNote, doc.note, note])
		const before = {
			note: rewrite(doc.editionNote ?? doc.note),
			included: doc.editionNote !== null,
		}
		const after = { note: rewrite(note ?? doc.note), includeNote: note !== null }
		const changed = await rewriteDraftNotes(tx, drafts, documentId, before, after)
		for (const editionId of new Set(changed)) await touch(tx, editionId)
		return note
	})
}

/** "Not now": no nudge, for a new edition or the draft, for a week (`NUDGE.snoozeDays`). */
export async function snoozeNudge(userId: string): Promise<void> {
	await writeNudgeSnooze(db, userId)
}

export type PublishResult =
	| { ok: true; edition: EditionRow }
	| { ok: false; problems: PublishProblem[] }

/**
 * Publish, Update and Publish again: the working copy becomes the public page. The first time sets
 * `publishedAt`, later ones `republishedAt`. With no change since the page was last written, it
 * stays as it is, and an unpublished one comes back. Only the first time counts against the
 * monthly edition cap (`limit_reached`). An edition an admin removed stays down (`edition_removed`).
 */
export async function publishEdition(userId: string, id: string): Promise<PublishResult> {
	return db.transaction(async (tx) => {
		const edition = await lockEdition(tx, userId, id)
		if (edition.removedAt) throw refuse("edition_removed")
		if (edition.publishedAt && !hasUnpublishedChanges(edition)) {
			if (!edition.unpublishedAt) return { ok: true, edition }
			return { ok: true, edition: await clearUnpublished(tx, id) }
		}
		const items = await listItems(tx, id)
		const problems = publishProblems(items)
		if (problems.length > 0) return { ok: false, problems }
		// Only the first time counts; any new text going public needs an account that may add.
		if (!edition.publishedAt) await countMonthly(tx, userId, "editions")
		else await checkMayAdd(userId)
		const author = await authorName(tx, userId)
		// Shared now: off the shortlist. Set aside, it stays marked for an edition to come.
		const shared = items.flatMap((item) =>
			item.documentId && item.included ? [item.documentId] : [],
		)
		await unmarkArticles(tx, userId, shared)
		return {
			ok: true,
			edition: await writeSnapshot(tx, edition, buildSnapshot(edition, items, author)),
		}
	})
}

/** Hides the public page. The snapshot stays, for Publish again. */
export async function unpublishEdition(userId: string, id: string): Promise<EditionRow> {
	return db.transaction(async (tx) => {
		const edition = await lockEdition(tx, userId, id)
		if (!edition.publishedAt) throw refuse("not_published")
		if (edition.unpublishedAt) return edition
		return markUnpublished(tx, id)
	})
}

/** For good: the items go with it, and the public link stops working. */
export async function deleteEdition(userId: string, id: string): Promise<void> {
	checkId(id)
	if (!(await deleteEditionRow(db, userId, id))) throw refuse("not_found")
}

/**
 * Adds every article of the shortlist the edition does not have yet, the oldest mark first: the
 * order they were read in. One without a web address is left out. How many it added.
 */
export async function addShortlist(userId: string, editionId: string): Promise<number> {
	await findEdition(userId, editionId)
	let added = 0
	for (const id of await shortlistNotIn(userId, editionId)) {
		try {
			await addItem(userId, editionId, id)
			added++
		} catch (error) {
			// No web address, or added meanwhile: the rest still go in.
			if (error instanceof AppError && (error.code === "no_url" || error.code === "already_added"))
				continue
			throw error
		}
	}
	return added
}

/**
 * Copies the article to the end of the edition. Only its note for editions is included; nothing
 * else is until the user says so. In a draft, the article is marked too: it is in the next edition,
 * as marking it would have made it, and removing it unmarks it.
 */
export async function addItem(
	userId: string,
	editionId: string,
	documentId: string,
): Promise<EditionItem> {
	const copy = await copyItem(userId, documentId, await findEdition(userId, editionId))
	return db.transaction(async (tx) => {
		const edition = await lockEdition(tx, userId, editionId)
		if (await itemOfArticle(tx, editionId, documentId)) throw refuse("already_added")
		const item = await appendItem(tx, editionId, documentId, copy)
		if (!edition.publishedAt) await markArticle(tx, userId, documentId)
		await touch(tx, editionId)
		return item
	})
}

/** One place up or down. At the first or last place already, nothing changes. */
export async function moveItem(
	userId: string,
	editionId: string,
	itemId: string,
	direction: "up" | "down",
): Promise<void> {
	await db.transaction(async (tx) => {
		await lockEdition(tx, userId, editionId)
		const item = await findItem(tx, editionId, itemId)
		const target = item.position + (direction === "up" ? -1 : 1)
		const other = await itemAt(tx, editionId, target)
		if (!other) return
		await swapItems(tx, item, { id: other, position: target })
		await touch(tx, editionId)
	})
}

/** What removing an item took away, so that undo can put it back (`restoreItem`). */
export interface RemovedItem {
	item: EditionItem
	/** The article's mark for the next edition, which removing took off; Postgres' own text. */
	shortlistedAt: string | null
}

/**
 * Takes the item out. Its article leaves the shortlist too: removed while composing, it was
 * considered and left out.
 */
export async function removeItem(
	userId: string,
	editionId: string,
	itemId: string,
): Promise<RemovedItem> {
	return db.transaction(async (tx) => {
		await lockEdition(tx, userId, editionId)
		checkId(itemId)
		const item = await deleteItem(tx, editionId, itemId)
		if (!item) throw refuse("not_found")
		const shortlistedAt = item.documentId ? await takeMark(tx, userId, item.documentId) : null
		await touch(tx, editionId)
		return { item, shortlistedAt }
	})
}

/**
 * Undo of `removeItem`: the item back where it was, as it was, and its article's mark. Refused when
 * the article is in the edition again (`already_added`).
 */
export async function restoreItem(
	userId: string,
	editionId: string,
	removed: RemovedItem,
): Promise<void> {
	const { item, shortlistedAt } = removed
	await db.transaction(async (tx) => {
		await lockEdition(tx, userId, editionId)
		if (item.editionId !== editionId) throw refuse("not_found")
		// Undone twice: back already.
		if (await itemExists(tx, item.id)) return
		if (item.documentId && (await itemOfArticle(tx, editionId, item.documentId)))
			throw refuse("already_added")
		await reinsertItem(tx, userId, item, shortlistedAt)
		await touch(tx, editionId)
	})
}

/**
 * Copies the article again. Selected highlights that still exist stay selected. The note copy is
 * replaced by the current note, edits and all, included as adding would: only the note for
 * editions is, and not when the user had left out this same text.
 */
export async function refreshItem(
	userId: string,
	editionId: string,
	itemId: string,
): Promise<EditionItem> {
	const edition = await findEdition(userId, editionId)
	const { documentId } = await findItem(db, editionId, itemId)
	if (!documentId) throw refuse("document_gone")
	const copy = await copyItem(userId, documentId, edition).catch((error: unknown) => {
		if (error instanceof AppError && error.code === "not_found") throw refuse("document_gone")
		throw error
	})
	return db.transaction(async (tx) => {
		await lockEdition(tx, userId, editionId)
		const item = await findItem(tx, editionId, itemId)
		const selected = new Set(item.highlights.filter((h) => h.included).map((h) => h.highlightId))
		const row = await writeItem(tx, itemId, {
			...copy,
			// The note for editions is included, unless the user left out this very text. A private
			// note is new text the user has not let out yet, whatever they included before.
			includeNote: copy.includeNote && (item.includeNote || item.note !== copy.note),
			highlights: copy.highlights.map((h) => ({ ...h, included: selected.has(h.highlightId) })),
		})
		await touch(tx, editionId)
		return row
	})
}

export interface ItemPatch {
	/** False sets the item aside. */
	included?: boolean
	includeNote?: boolean
	/** The edition's copy. The library's note stays as it is. */
	note?: string | null
	/** By highlight id. Ids the item no longer has are skipped: a refresh elsewhere dropped them. */
	highlights?: Array<{ highlightId: string; included?: boolean; note?: string | null }>
}

/**
 * Changes what the item shows. Including a highlight that breaks the quote cap is refused. Other
 * changes are always saved, even while a refresh has left the item over the cap.
 */
export async function updateItem(
	userId: string,
	editionId: string,
	itemId: string,
	patch: ItemPatch,
): Promise<EditionItem> {
	const note = patch.note === undefined ? undefined : cleanText(patch.note, NOTE_MAX, "note")
	const changes = new Map(
		(patch.highlights ?? []).map((h) => [
			h.highlightId,
			{
				included: h.included,
				note: h.note === undefined ? undefined : cleanText(h.note, NOTE_MAX, "note"),
			},
		]),
	)
	return db.transaction(async (tx) => {
		await lockEdition(tx, userId, editionId)
		const item = await findItem(tx, editionId, itemId)
		const highlights = item.highlights.map((h) => {
			const change = changes.get(h.highlightId)
			if (!change) return h
			return {
				...h,
				included: change.included ?? h.included,
				note: change.note === undefined ? h.note : change.note,
			}
		})
		if (highlights.some((h, i) => h.included && !item.highlights[i]!.included)) {
			const problem = quoteProblem(includedQuotes(highlights), item.wordCount)
			if (problem)
				throw new AppError("quote_cap", "That would quote more of the article than an item may.", {
					details: { quoteProblem: problem },
				})
		}
		const next = {
			included: patch.included ?? item.included,
			includeNote: patch.includeNote ?? item.includeNote,
			note: note === undefined ? item.note : note,
			highlights,
		}
		if (
			next.included === item.included &&
			next.includeNote === item.includeNote &&
			next.note === item.note &&
			JSON.stringify(next.highlights) === JSON.stringify(item.highlights)
		)
			return item
		const row = await writeItem(tx, itemId, next)
		await touch(tx, editionId)
		return row
	})
}
