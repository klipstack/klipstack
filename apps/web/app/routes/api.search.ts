import { data } from "react-router"
import { getUser } from "~/lib/session.server"
import { quickFindAnnotations } from "~/services/annotation-search.server"
import { quickFind, recentDocuments } from "~/services/search.server"
import type { Route } from "./+types/api.search"

/** Articles the note link menu offers before anything is typed. */
const RECENT_LIMIT = 8

/**
 * GET /api/search?q=&exclude= → compact results for the command palette and the note link menu.
 * A quick open by title, site, author or address, not the search: that is the search page's.
 * A blank `q` answers with the most recently read or saved articles; `exclude` drops one id.
 * `annotations=1` (the palette) adds the highlights and article notes that have the typed words.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
	const user = getUser(context)
	if (!user) return data({ error: "unauthorized" }, { status: 401 })
	const params = new URL(request.url).searchParams
	const q = params.get("q") ?? ""
	const exclude = params.get("exclude")
	const [items, annotations] = await Promise.all([
		q.trim()
			? quickFind({ userId: user.id, q, limit: 12, exclude })
			: recentDocuments({ userId: user.id, limit: RECENT_LIMIT, exclude }),
		params.get("annotations") === "1" && q.trim()
			? quickFindAnnotations({ userId: user.id, q })
			: { highlights: [], notes: [] },
	])
	return {
		...annotations,
		items: items.map((d) => ({
			id: d.id,
			title: d.title ?? d.sourceUrl,
			siteName: d.siteName,
			status: d.status,
			archived: Boolean(d.archivedAt),
		})),
	}
}
