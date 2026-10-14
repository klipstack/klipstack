import { data } from "react-router"
import { skipArticleNote, snoozeNoteReminderCard } from "~/commands/note-reminders.server"
import { AppError } from "~/lib/app-error"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { answer } from "~/lib/web-action.server"
import type { Route } from "./+types/home.notes"

/**
 * POST /home/notes (form, `intent`: skip | unskip, `id`; or snooze): Home's question about
 * articles finished without a note. "Nothing to add" on one and its undo, or "Not now" on the card.
 * Answers `{ok: true}`, or the command's refusal.
 */
export async function action({ request, context }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const form = await readForm(request)
	const id = String(form.get("id") ?? "")
	const intent = form.get("intent")
	return answer(async () => {
		if (intent === "skip") await skipArticleNote(user.id, id)
		else if (intent === "unskip") await skipArticleNote(user.id, id, false)
		else if (intent === "snooze") await snoozeNoteReminderCard(user.id)
		else throw new AppError("invalid_request", "Unknown intent.")
		return {}
	})
}

export async function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
