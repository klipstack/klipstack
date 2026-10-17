import { data } from "react-router"
import { AppError } from "~/lib/app-error"
import { HIGHLIGHT_SHAPES, type HighlightShape } from "~/lib/highlight-card.server"
import { getUser } from "~/lib/session.server"
import { drawHighlightImage } from "~/services/highlight-image.server"
import type { Route } from "./+types/highlights.image"

/**
 * GET /highlights/:id/image.png?shape=wide|tall&note=1|0 — the reader's own highlight as a picture
 * to share by itself (`drawHighlightImage`). Refusals are bare statuses: 404, 422 for a quote the
 * fonts cannot draw, 429.
 */
export async function loader({ request, context, params }: Route.LoaderArgs) {
	const user = getUser(context)
	if (!user) throw data(null, { status: 401 })
	const query = new URL(request.url).searchParams
	const shape = (query.get("shape") ?? "wide") as HighlightShape
	if (!HIGHLIGHT_SHAPES.includes(shape)) throw data(null, { status: 400 })
	const withNote = query.get("note") !== "0"
	try {
		const png = await drawHighlightImage(user.id, params.id, { shape, withNote })
		return new Response(new Uint8Array(png), {
			headers: {
				"Content-Type": "image/png",
				"Content-Length": String(png.length),
				"Cache-Control": "private, no-store",
			},
		})
	} catch (error) {
		if (!(error instanceof AppError)) throw error
		throw data(null, {
			status: error.status,
			headers:
				error.retryAfter !== undefined ? { "Retry-After": String(error.retryAfter) } : undefined,
		})
	}
}
