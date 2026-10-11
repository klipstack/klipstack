import { z } from "zod"
import {
	openArticle,
	purgeArticle,
	readPostInstead,
	restoreArticle,
	retryArticle,
	saveReadingPosition,
	trashArticle,
	undoArchive,
	updateArticle,
} from "~/commands/articles.server"
import { AppError } from "~/lib/app-error"
import { answerNetworkFailure } from "~/lib/network-failure"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { signUndo } from "~/lib/undo-token.server"
import { answer, refused } from "~/lib/web-action.server"
import type { Route } from "./+types/documents.state"

const INTENTS = [
	"archive",
	"unarchive",
	// Undo of "archive": back to the library exactly as it was, still finished if it was.
	"undo-archive",
	"star",
	"unstar",
	"shortlist",
	"unshortlist",
	"finish",
	"unread",
	"open",
	"progress",
	"retry",
	"delete",
	"restore",
	"purge",
	"rename",
	// The post an article was saved through, read instead of the article.
	"read-post",
] as const

export type StateIntent = (typeof INTENTS)[number]

/** Background saves (progress, "open") and taps offline must not replace the page. */
export async function clientAction({ serverAction }: Route.ClientActionArgs) {
	return answerNetworkFailure(serverAction)
}

/**
 * POST /documents/:id/state (form: `intent`, plus `progress` and `cycle`, or `title`). One
 * article's change, through the same commands as bulk changes and the API. Answers
 * `{ok: true, intent}`, or the command's refusal.
 */
export async function action({ request, context, params }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const form = await readForm(request)
	const parsed = z.enum(INTENTS).safeParse(form.get("intent"))
	if (!parsed.success) return refused(new AppError("invalid_request", "Unknown intent."))
	const intent = parsed.data
	const id = params.id
	return answer(async () => {
		switch (intent) {
			case "archive":
			case "unarchive":
				await updateArticle(user.id, id, { location: intent === "archive" ? "archive" : "inbox" })
				break
			case "undo-archive":
				await undoArchive(user.id, [id])
				break
			case "star":
			case "unstar":
				await updateArticle(user.id, id, { starred: intent === "star" })
				break
			case "shortlist":
			case "unshortlist": {
				const { undo } = await updateArticle(user.id, id, { shortlisted: intent === "shortlist" })
				// Taken out of the draft in progress: its copy there, edits and all, comes back only so.
				if (intent === "unshortlist" && undo.draft)
					return { intent, undo: { intent: "revert", fields: { token: signUndo(user.id, undo) } } }
				break
			}
			case "finish":
			case "unread":
				await updateArticle(user.id, id, { finished: intent === "finish" })
				break
			case "rename":
				await updateArticle(user.id, id, { title: String(form.get("title") ?? "") })
				break
			case "open":
				await openArticle(user.id, id)
				break
			case "progress": {
				const cycle = form.get("cycle")
				await saveReadingPosition(user.id, id, {
					position: Number(form.get("progress")),
					cycle: cycle === null ? undefined : Number(cycle),
				})
				break
			}
			case "retry":
				await retryArticle(user.id, id)
				break
			case "delete":
				await trashArticle(user.id, id)
				break
			case "restore":
				await restoreArticle(user.id, id)
				break
			case "purge":
				await purgeArticle(user.id, id)
				break
			case "read-post":
				await readPostInstead(user.id, id)
				break
		}
		return { intent }
	})
}
