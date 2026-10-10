import { isUuid } from "~/lib/page-cursor"
import { requireUser } from "~/lib/session.server"
import { countBacklinks } from "~/services/links.server"
import type { Route } from "./+types/documents.backlinks"

/** GET /documents/:id/backlinks → how many live notes link to this article. */
export async function loader({ context, request, params }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	if (!isUuid(params.id)) return { count: 0 }
	return { count: await countBacklinks(user.id, params.id) }
}
