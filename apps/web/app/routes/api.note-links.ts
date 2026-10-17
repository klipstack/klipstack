import { data } from "react-router"
import { getUser } from "~/lib/session.server"
import { linkTargetDetails } from "~/services/links.server"
import type { Route } from "./+types/api.note-links"

/** More than one note's links ever are. */
const IDS_MAX = 500
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * GET /api/note-links?id=…&id=… — the original address of each of the reader's articles that a
 * note links to, for sharing the note: its links then lead somewhere for anyone. Another reader's
 * article, or one that is gone, is left out.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
	const user = getUser(context)
	if (!user) return data({ urls: {} }, { status: 401 })
	const ids = new URL(request.url).searchParams.getAll("id")
	if (ids.length > IDS_MAX) return data({ urls: {} }, { status: 400 })
	const targets = await linkTargetDetails(
		user.id,
		ids.filter((id) => UUID.test(id)),
	)
	return { urls: Object.fromEntries(Object.entries(targets).map(([id, t]) => [id, t.url])) }
}
