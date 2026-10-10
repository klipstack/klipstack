import { data } from "react-router"
import { getUser } from "~/lib/session.server"
import { listTags } from "~/services/tags.server"
import type { Route } from "./+types/api.tags"

/** GET /api/tags → every tag of the user, for the tag picker. */
export async function loader({ context }: Route.LoaderArgs) {
	const user = getUser(context)
	if (!user) return data({ error: "unauthorized" }, { status: 401 })
	return { tags: await listTags(user.id) }
}
