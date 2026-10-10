import { data } from "react-router"
import { z } from "zod"
import { updateArticle } from "~/commands/articles.server"
import { AppError } from "~/lib/app-error"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { answer, refused } from "~/lib/web-action.server"
import { documentTagList } from "~/services/tags.server"
import type { Route } from "./+types/documents.tags"

const intent = z.enum(["add", "remove"])

/** POST /documents/:id/tags  intent=add|remove, name. Answers with the article's tags. */
export async function action({ request, context, params }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const form = await readForm(request)
	const parsed = intent.safeParse(form.get("intent"))
	if (!parsed.success) return refused(new AppError("invalid_request", "Unknown intent."))
	const name = String(form.get("name") ?? "")
	return answer(async () => {
		await updateArticle(
			user.id,
			params.id,
			parsed.data === "add" ? { addTags: [name] } : { removeTags: [name] },
		)
		return { tags: await documentTagList(params.id) }
	})
}

export async function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
