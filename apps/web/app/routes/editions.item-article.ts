import { requireEditions } from "~/lib/features.server"
import { requireUser } from "~/lib/session.server"
import { answer } from "~/lib/web-action.server"
import { itemArticle } from "~/services/editions.server"
import type { Route } from "./+types/editions.item-article"

/**
 * GET /editions/:id/items/:itemId/article — the article an edition item came from, as the library
 * keeps it: the editor's article pane reads it without leaving the editor. Read only.
 */
export async function loader({ request, context, params }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	await requireEditions(user.id)
	return answer(async () => ({ article: await itemArticle(user.id, params.id, params.itemId) }))
}
