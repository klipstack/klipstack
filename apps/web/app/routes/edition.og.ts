import { data, redirect } from "react-router"
import { canDraw, cachedCard, cardFor, cardVersion } from "~/lib/edition-card.server"
import { getInstance } from "~/lib/i18n.server"
import { shareCard } from "~/lib/share-card.server"
import { getPublicEdition, parseSnapshot } from "~/services/editions.server"
import type { Route } from "./+types/edition.og"

/**
 * GET /e/:publicId/og.png — the published edition's picture for link previews, drawn from its
 * snapshot (`lib/edition-card.server.ts`). Gone when the page is gone. A title the font cannot draw
 * gets the Klipstack card instead.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
	const edition = await getPublicEdition(params.publicId)
	if (!edition) throw data(null, { status: 404 })
	if (edition.removedAt || edition.unpublishedAt) throw data(null, { status: 410 })
	const snapshot = parseSnapshot(edition.published)
	if (!snapshot) throw new Error(`Edition ${params.publicId}: a snapshot this code cannot read`)
	if (snapshot.title !== null && !canDraw(snapshot.title))
		throw redirect(shareCard(snapshot.locale).url)
	const t = getInstance(context).getFixedT(snapshot.locale, "editions")
	const { publishedAt, timeZone } = edition
	const png = await cachedCard(`${params.publicId}:${cardVersion(edition)}`, () =>
		cardFor(snapshot, { publishedAt: publishedAt!, timeZone }, t),
	)
	return new Response(new Uint8Array(png), {
		headers: { "Content-Type": "image/png", "Content-Length": String(png.length) },
	})
}
