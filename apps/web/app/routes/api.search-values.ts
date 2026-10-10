import { data } from "react-router"
import { getUser } from "~/lib/session.server"
import { operatorValues } from "~/services/search.server"
import type { Route } from "./+types/api.search-values"

/** GET /api/search/values?key=site|author|tag&q= → the library's values, for the search field. */
export async function loader({ request, context }: Route.LoaderArgs) {
	const user = getUser(context)
	if (!user) return data({ error: "unauthorized" }, { status: 401 })
	const params = new URL(request.url).searchParams
	const key = params.get("key")
	if (key !== "site" && key !== "author" && key !== "tag")
		return data({ error: "invalid_key" }, { status: 400 })
	return { values: await operatorValues({ userId: user.id, key, q: params.get("q") ?? "" }) }
}
