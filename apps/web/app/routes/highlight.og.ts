import { data, redirect } from "react-router"
import {
	cachedHighlightCard,
	canDrawHighlight,
	highlightCardFor,
} from "~/lib/highlight-card.server"
import { shareCard } from "~/lib/share-card.server"
import { getPublicShare } from "~/services/highlight-shares.server"
import type { Route } from "./+types/highlight.og"

/**
 * GET /h/:publicId/og.png — the shared highlight's picture for link previews, drawn from its
 * snapshot (`lib/highlight-card.server.ts`). Gone when the page is gone. A quote the font cannot
 * draw gets the Klipstack card instead.
 */
export async function loader({ params }: Route.LoaderArgs) {
	const share = await getPublicShare(params.publicId)
	if (!share) throw data(null, { status: 404 })
	if (share.status !== "live") throw data(null, { status: 410 })
	const { snapshot } = share
	if (!canDrawHighlight(snapshot.exact)) throw redirect(shareCard(snapshot.locale).url)
	const png = await cachedHighlightCard(`${params.publicId}:${share.updatedAt.getTime()}`, () =>
		highlightCardFor(snapshot),
	)
	return new Response(new Uint8Array(png), {
		headers: { "Content-Type": "image/png", "Content-Length": String(png.length) },
	})
}
