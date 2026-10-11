import { db } from "@klipstack/db"
import { supportedLanguages } from "@klipstack/i18n"
import { z } from "zod"
import { AppError, parseInput } from "~/lib/app-error"
import {
	addItem,
	addShortlist,
	createEdition as insertEdition,
	currentDraft,
	deleteEdition,
	moveItem,
	publishEdition,
	refreshItem,
	type RemovedItem,
	removeItem,
	restoreItem,
	setEditionNote,
	snoozeNudge,
	unpublishEdition,
	updateEdition,
	updateItem,
} from "~/services/editions.server"

/**
 * The user's editions, for the web. The limits are in the services, which refuse with the field
 * that broke one (`details.field`).
 */

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
	}),
	z.object({ intent: z.literal("add-item"), documentId: id }),
	/** Every article of the shortlist the edition does not have yet. */
	z.object({ intent: z.literal("add-shortlist") }),
	z.object({
		intent: z.literal("update-item"),
		itemId: id,
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
	const edition = await insertEdition(userId, input)
	await addShortlist(userId, edition.id)
	return edition
}

/**
 * "Start" on `/editions`: the draft in progress, else a new one (`createEdition`). One draft at a
 * time is what the page offers; a second only comes from asking for it.
 */
export async function startEdition(userId: string, input: { locale: string; timeZone: string }) {
	return (await currentDraft(db, userId)) ?? createEdition(userId, input)
}

const EditionNote = z.object({ note: text.nullable() })

/**
 * What to tell an edition's readers about an article, written at its end while reading. Blank or
 * null clears it. The article's editions to come start with it included.
 */
export async function setArticleEditionNote(userId: string, documentId: string, input: unknown) {
	const { note } = parseInput(EditionNote, input)
	return { editionNote: await setEditionNote(userId, documentId, note) }
}

/** "Not now" on the nudge for a new edition: none for a week. */
export function snoozeEditionNudge(userId: string) {
	return snoozeNudge(userId)
}

/**
 * Undo of removing an item: what `changeEdition` answered for it (`removed`), which the caller kept
 * safe from changes (the web signs it).
 */
export function restoreEditionItem(userId: string, editionId: string, removed: RemovedItem) {
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
