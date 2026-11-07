import { z } from "zod"
import { translateArticle, showOriginal } from "~/commands/translation.server"
import { AppError } from "~/lib/app-error"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { answer, refused } from "~/lib/web-action.server"
import type { Route } from "./+types/documents.translation"

/**
 * POST /documents/:id/translation (form: `intent`). `translate`: into the account's language,
 * answered with `{status, credits}`; `original`: the original shown again.
 */
export async function action({ request, context, params }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const intent = z
		.enum(["translate", "original"])
		.safeParse((await readForm(request)).get("intent"))
	if (!intent.success) return refused(new AppError("invalid_request", "Unknown intent."))
	return answer(async () =>
		intent.data === "translate"
			? { intent: intent.data, ...(await translateArticle(user.id, { id: params.id })) }
			: { intent: intent.data, ...(await showOriginal(user.id, { id: params.id })) },
	)
}
