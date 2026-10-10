import { data } from "react-router"
import { rateLimit } from "~/lib/rate-limit.server"
import { getUser } from "~/lib/session.server"
import { getLinkPreview, PREVIEW_LIMIT, previewableUrl } from "~/services/link-preview.server"
import type { Route } from "./+types/api.link-preview"

/** GET /api/link-preview?url=… — metadata for the reader's link card, without saving it. */
export async function loader({ request, context }: Route.LoaderArgs) {
	const user = getUser(context)
	if (!user) return data({ preview: null }, { status: 401 })
	const url = previewableUrl(new URL(request.url).searchParams.get("url") ?? "")
	if (!url) return data({ preview: null }, { status: 400 })
	const limited = rateLimit(`link-preview:${user.id}`, PREVIEW_LIMIT.limit, PREVIEW_LIMIT.windowMs)
	if (!limited.ok)
		return data(
			{ preview: null },
			{ status: 429, headers: { "retry-after": String(limited.retryAfterSeconds) } },
		)
	return { preview: await getLinkPreview(url.href) }
}
