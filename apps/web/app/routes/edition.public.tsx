import { data, redirect } from "react-router"
import { EditionPage } from "~/components/edition-page"
import { CARD_HEIGHT, CARD_WIDTH, canDraw, cardVersion } from "~/lib/edition-card.server"
import { editionDescription, editionView } from "~/lib/edition-view"
import { editionSlug } from "~/lib/editions"
import { env } from "~/lib/env.server"
import { getInstance } from "~/lib/i18n.server"
import { shareCard } from "~/lib/share-card.server"
import type { PageLanguage } from "~/root"
import { editionNeighbors, getPublicEdition, parseSnapshot } from "~/services/editions.server"
import type { Route } from "./+types/edition.public"

/** GET /e/:publicId/:slug? — a published edition, for anyone with the link. */
export async function loader({ params, request, context }: Route.LoaderArgs) {
	const edition = await getPublicEdition(params.publicId)
	if (!edition) throw data(null, { status: 404 })
	// Taken down by an admin, the page says so: not that its author did.
	if (edition.removedAt) throw data({ removed: true }, { status: 410 })
	if (edition.unpublishedAt) throw data(null, { status: 410 })
	const snapshot = parseSnapshot(edition.published)
	if (!snapshot) throw new Error(`Edition ${params.publicId}: a snapshot this code cannot read`)
	// Never null here: `getPublicEdition` finds published editions only.
	const publishedAt = edition.publishedAt!
	const path = `/e/${params.publicId}/${editionSlug(snapshot.title, publishedAt, edition.timeZone)}`
	// The slug follows the title, so links shared before a rename still arrive.
	if (new URL(request.url).pathname !== path)
		throw redirect(path + new URL(request.url).search, 301)
	const t = getInstance(context).getFixedT(snapshot.locale, "editions")
	const neighbors = await editionNeighbors(
		edition.userId,
		{ id: edition.id, publishedAt },
		snapshot.locale,
	)
	return {
		view: editionView(snapshot, { ...edition, publishedAt }, t, neighbors),
		reportHref: `/e/${params.publicId}/report`,
		url: `${env.APP_URL}${path}`,
		description: editionDescription(snapshot, t),
		// Its own picture (title and contents), at an address that changes with each Update. A title
		// in a script the font lacks gets the Klipstack card.
		image:
			snapshot.title === null || canDraw(snapshot.title)
				? `${env.APP_URL}/e/${params.publicId}/og.png?v=${cardVersion(edition)}`
				: shareCard(snapshot.locale).url,
		imageSize: { width: CARD_WIDTH, height: CARD_HEIGHT },
	}
}

/**
 * Unlisted: kept out of search results. Sites a reader clicks through to see this site, never the
 * edition's address.
 */
export function headers() {
	return {
		"X-Robots-Tag": "noindex",
		"Referrer-Policy": "strict-origin-when-cross-origin",
	}
}

/** The page speaks the edition's language, whoever visits. */
export const handle: PageLanguage = {
	lang: (loaderData) => (loaderData as Route.ComponentProps["loaderData"] | undefined)?.view.locale,
}

export function meta({ loaderData }: Route.MetaArgs) {
	const noindex = { name: "robots", content: "noindex" }
	if (!loaderData) return [{ title: "Klipstack" }, noindex]
	const { view, url, description, image, imageSize } = loaderData
	return [
		// The date is in the window's title either way: the page's own title, or beside the author.
		{ title: [view.title, view.authorName, view.date].filter(Boolean).join(" · ") },
		noindex,
		{ name: "description", content: description },
		{ property: "og:type", content: "article" },
		{ property: "og:site_name", content: "Klipstack" },
		{ property: "og:title", content: view.title },
		{ property: "og:description", content: description },
		{ property: "og:url", content: url },
		{ property: "og:image", content: image },
		// Both pictures, the edition's and the Klipstack card, are this size.
		{ property: "og:image:width", content: String(imageSize.width) },
		{ property: "og:image:height", content: String(imageSize.height) },
		{ property: "og:image:alt", content: view.title },
		{ name: "twitter:card", content: "summary_large_image" },
	]
}

export default function PublicEdition({ loaderData }: Route.ComponentProps) {
	return <EditionPage view={loaderData.view} reportHref={loaderData.reportHref} />
}
