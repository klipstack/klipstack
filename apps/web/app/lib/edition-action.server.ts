import { changeEdition, restoreEditionItem } from "~/commands/editions.server"
import type { RemovedItem } from "~/services/editions.server"
import { AppError } from "./app-error"
import { readUndo, signUndo } from "./undo-token.server"

/** What the editor's changes answer on the web. */
export interface EditionDone {
	deleted?: true
	/** How many articles `add-shortlist` added. */
	added?: number
	/** After `remove-item`: the signed undo, which `restore-item` takes back (`token`). */
	undo?: string
	/** After `remove-item`: its article left the shortlist too. */
	unmarked?: boolean
}

/**
 * One editor change, as the editor's page and its autosave run it (`changeEdition`). Removing an
 * item answers its undo, signed: the item comes back as it was, never as the page says it was.
 */
export async function editionAction(
	userId: string,
	editionId: string,
	fields: Record<string, unknown>,
): Promise<EditionDone> {
	if (fields.intent === "restore-item") {
		const removed = readUndo<RemovedItem>(userId, String(fields.token ?? ""))
		if (!removed) throw new AppError("invalid_request", "This undo has expired.")
		await restoreEditionItem(userId, editionId, removed)
		return {}
	}
	const { removed, ...done } = await changeEdition(userId, editionId, fields)
	if (!removed) return done
	return { ...done, undo: signUndo(userId, removed), unmarked: removed.shortlistedAt !== null }
}
