import { data } from "react-router"
import { setArticleEditionNote } from "~/commands/editions.server"
import { readFields } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { answer } from "~/lib/web-action.server"
import type { Route } from "./+types/documents.edition-note"

/**
 * POST /documents/:id/edition-note — JSON or form body `{ note }`, the note for editions from the
 * end of the article. Blank or null clears it. Autosaved: the last save wins.
 */
export async function action({ request, context, params }: Route.ActionArgs) {
	const user = requireUser(context, request)
	return answer(async () => setArticleEditionNote(user.id, params.id, await readFields(request)))
}

export async function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
