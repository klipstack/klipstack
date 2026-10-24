import { closeNews } from "~/commands/news.server"
import { requireUser } from "~/lib/session.server"
import { answer } from "~/lib/web-action.server"
import type { Route } from "./+types/news.close"

/** POST /news/:slug/close — the sidebar's news card is closed, or opened. */
export async function action({ context, request, params }: Route.ActionArgs) {
	const user = requireUser(context, request)
	return answer(() => closeNews(user.id, { slug: params.slug }))
}
