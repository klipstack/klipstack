import { data } from "react-router"
import { z } from "zod"
import {
	type ArticleChanges,
	purgeArticles,
	restoreArticles,
	trashArticles,
	undoChanges,
	updateArticles,
} from "~/commands/articles.server"
import { AppError } from "~/lib/app-error"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { readUndo, signUndo } from "~/lib/undo-token.server"
import { answer, refused } from "~/lib/web-action.server"
import type { UndoRecord } from "~/services/article-undo.server"
import type { Route } from "./+types/documents.bulk"

const INTENTS = [
	"star",
	"unstar",
	"shortlist",
	"unshortlist",
	"archive",
	"unarchive",
	"finish",
	"unread",
	"again",
	"keep",
	"delete",
	"restore",
	"purge",
	"tag",
	"revert",
] as const

export type BulkIntent = (typeof INTENTS)[number]

/** The form the toast posts back to undo; `fields` go with `intent`. */
export interface BulkUndo {
	intent: string
	fields: Record<string, string>
}

export interface BulkDone {
	intent: BulkIntent
	/** The articles that changed; the others were in that state already, or not the user's. */
	changed: string[]
	undo: BulkUndo | null
	/** Restores refused because the page was saved again: `articleId` is the live one. */
	alreadySaved?: Array<{ id: string; articleId: string }>
}

/** What each state intent changes. */
const CHANGES: Record<string, ArticleChanges> = {
	star: { starred: true },
	unstar: { starred: false },
	shortlist: { shortlisted: true },
	unshortlist: { shortlisted: false },
	archive: { location: "archive" },
	unarchive: { location: "inbox" },
	finish: { finished: true },
	unread: { finished: false },
	// Read again: unread, and back in the library from the archive. Home shows it under Read again.
	again: { finished: false, location: "inbox" },
	keep: { kept: true },
}

/**
 * POST /documents/bulk  (form: intent, ids (comma-separated), name (repeated, for `tag`), token
 * (for `revert`)). Changes many articles at once, through the same commands as one article's
 * changes and the API.
 */
export async function action({ request, context }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const form = await readForm(request)
	const parsedIntent = z.enum(INTENTS).safeParse(form.get("intent"))
	if (!parsedIntent.success) return refused(new AppError("invalid_request", "Unknown intent."))
	const intent = parsedIntent.data
	const done = (changed: string[], undo: BulkUndo | null): BulkDone => ({
		intent,
		changed,
		undo: changed.length > 0 ? undo : null,
	})
	const revertable = (undo: UndoRecord): BulkUndo => ({
		intent: "revert",
		fields: { token: signUndo(user.id, undo) },
	})
	const ids = String(form.get("ids") ?? "")
		.split(",")
		.filter(Boolean)

	return answer(async (): Promise<BulkDone> => {
		switch (intent) {
			case "revert": {
				const undo = readUndo<UndoRecord>(user.id, String(form.get("token") ?? ""))
				if (!undo) throw new AppError("invalid_request", "This undo has expired.")
				return done(await undoChanges(user.id, undo), null)
			}
			case "delete": {
				const { trashed } = await trashArticles(user.id, ids)
				return done(trashed, { intent: "restore", fields: { ids: trashed.join(",") } })
			}
			case "restore": {
				const { restored, alreadySaved } = await restoreArticles(user.id, ids)
				return {
					...done(restored, { intent: "delete", fields: { ids: restored.join(",") } }),
					alreadySaved,
				}
			}
			// Gone for good: nothing to undo. The selection bar asks for a second tap first.
			case "purge": {
				const { purged } = await purgeArticles(user.id, ids)
				return done(purged, null)
			}
			case "tag": {
				const addTags = form.getAll("name").map(String)
				const { changed, undo } = await updateArticles(user.id, { ids, addTags })
				return done(changed, revertable(undo))
			}
			default: {
				const { changed, undo } = await updateArticles(user.id, { ids, ...CHANGES[intent] })
				return done(changed, revertable(undo))
			}
		}
	})
}

export async function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
