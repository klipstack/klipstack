import { createHash } from "node:crypto"
import { Id } from "@klipstack/api-contract"
import { AppError, notFound } from "~/lib/app-error"
import {
	cachedHighlightImage,
	canDrawHighlight,
	type HighlightShape,
	highlightCardFor,
} from "~/lib/highlight-card.server"
import { rateLimit } from "~/lib/rate-limit.server"
import { getHighlightWithArticle } from "./highlights.server"

/** Pictures drawn per reader, on the web and through the API: one per shape and note choice shown. */
export const IMAGE_LIMIT = { limit: 120, windowMs: 60 * 60 * 1000 }

/**
 * The reader's own highlight as a picture to share by itself, drawn as its public page's preview
 * is, from the highlight as it is now. It needs no public link and stores nothing. Refused:
 * `rate_limited` past IMAGE_LIMIT, `not_found` for one that is not theirs (or deleted, or its
 * article trashed), `cannot_draw` for a quote the fonts cannot draw.
 */
export async function drawHighlightImage(
	userId: string,
	id: string,
	{ shape, withNote }: { shape: HighlightShape; withNote: boolean },
): Promise<Buffer> {
	const limited = rateLimit(`highlight-image:${userId}`, IMAGE_LIMIT.limit, IMAGE_LIMIT.windowMs)
	if (!limited.ok)
		throw new AppError("rate_limited", "Too many pictures drawn. Try again later.", {
			retryAfter: limited.retryAfterSeconds,
		})
	const parsed = Id.safeParse(id)
	const h = parsed.success ? await getHighlightWithArticle(userId, parsed.data) : null
	if (!h) throw notFound("No highlight with that id.")
	if (!canDrawHighlight(h.exact))
		throw new AppError("cannot_draw", "The quote has characters the picture cannot draw.")

	const snapshot = {
		exact: h.exact,
		note: withNote && h.note?.trim() ? h.note.trim() : null,
		article: { title: h.documentTitle, url: h.sourceUrl, siteName: h.siteName },
	}
	// Drawn again only when what it shows changed.
	const version = createHash("sha256").update(JSON.stringify(snapshot)).digest("base64url")
	return cachedHighlightImage(
		`image:${userId}:${shape}:${version}`,
		() => highlightCardFor(snapshot),
		shape,
	)
}
