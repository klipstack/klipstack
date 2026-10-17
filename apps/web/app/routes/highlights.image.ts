import { createHash } from "node:crypto"
import { Id } from "@klipstack/api-contract"
import { data } from "react-router"
import {
	cachedHighlightImage,
	canDrawHighlight,
	HIGHLIGHT_SHAPES,
	type HighlightShape,
	highlightCardFor,
} from "~/lib/highlight-card.server"
import { rateLimit } from "~/lib/rate-limit.server"
import { getUser } from "~/lib/session.server"
import { getHighlightWithArticle } from "~/services/highlights.server"
import type { Route } from "./+types/highlights.image"

/** Pictures drawn per reader: the dialog draws one per shape and note choice it shows. */
export const IMAGE_LIMIT = { limit: 120, windowMs: 60 * 60 * 1000 }

/**
 * GET /highlights/:id/image.png?shape=wide|tall&note=1|0 — the reader's own highlight as a picture
 * to share by itself: drawn as its public page's preview is, from the highlight as it is now. It
 * needs no public link and stores nothing. A quote the fonts cannot draw is refused (422).
 */
export async function loader({ request, context, params }: Route.LoaderArgs) {
	const user = getUser(context)
	if (!user) throw data(null, { status: 401 })
	const query = new URL(request.url).searchParams
	const shape = (query.get("shape") ?? "wide") as HighlightShape
	if (!HIGHLIGHT_SHAPES.includes(shape)) throw data(null, { status: 400 })
	const withNote = query.get("note") !== "0"
	const limited = rateLimit(`highlight-image:${user.id}`, IMAGE_LIMIT.limit, IMAGE_LIMIT.windowMs)
	if (!limited.ok)
		throw data(null, {
			status: 429,
			headers: { "Retry-After": String(limited.retryAfterSeconds) },
		})
	const id = Id.safeParse(params.id)
	const h = id.success ? await getHighlightWithArticle(user.id, id.data) : null
	if (!h) throw data(null, { status: 404 })
	if (!canDrawHighlight(h.exact)) throw data(null, { status: 422 })

	const snapshot = {
		exact: h.exact,
		note: withNote && h.note?.trim() ? h.note.trim() : null,
		article: { title: h.documentTitle, url: h.sourceUrl, siteName: h.siteName },
	}
	// Drawn again only when what it shows changed.
	const version = createHash("sha256").update(JSON.stringify(snapshot)).digest("base64url")
	const png = await cachedHighlightImage(
		`image:${user.id}:${shape}:${version}`,
		() => highlightCardFor(snapshot),
		shape,
	)
	return new Response(new Uint8Array(png), {
		headers: {
			"Content-Type": "image/png",
			"Content-Length": String(png.length),
			"Cache-Control": "private, no-store",
		},
	})
}
