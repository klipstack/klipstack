import { data } from "react-router"
import { resumeResurfacing, stopResurfacing } from "~/commands/resurfacing.server"
import { AppError } from "~/lib/app-error"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { answer } from "~/lib/web-action.server"
import type { Route } from "./+types/home.highlights"

/**
 * POST /home/highlights (form, `intent`: dismiss | restore, `id`): "Not useful anymore" on Home's
 * highlights, and its undo. Answers `{ok: true, id}`, or the command's refusal.
 */
export async function action({ request, context }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const form = await readForm(request)
	const id = String(form.get("id") ?? "")
	const intent = form.get("intent")
	return answer(async () => {
		if (intent === "dismiss") await stopResurfacing(user.id, id)
		else if (intent === "restore") await resumeResurfacing(user.id, id)
		else throw new AppError("invalid_request", "Unknown intent.")
		return { id }
	})
}

export async function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
