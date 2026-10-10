import { requireUser } from "~/lib/session.server"
import { exportOpml } from "~/services/feeds.server"
import type { Route } from "./+types/feed.opml"

/** GET /feed/opml — the feeds the user follows, as a file other feed readers import. */
export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	return new Response(await exportOpml(user.id), {
		headers: {
			"content-type": "text/x-opml; charset=utf-8",
			"content-disposition": 'attachment; filename="klipstack-feeds.opml"',
			"cache-control": "no-store",
		},
	})
}
