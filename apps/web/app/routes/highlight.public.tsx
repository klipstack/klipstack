import { data, redirect } from "react-router"
import { SharedHighlightPage } from "~/components/shared-highlight-page"
import { CARD_HEIGHT, CARD_WIDTH } from "~/lib/edition-card.server"
import { env } from "~/lib/env.server"
import { canDrawHighlight } from "~/lib/highlight-card.server"
import { getInstance } from "~/lib/i18n.server"
import { shareCard } from "~/lib/share-card.server"
import { safeHost } from "~/lib/site-label"
import type { PageLanguage } from "~/root"
import { getPublicShare, sharePath } from "~/services/highlight-shares.server"
import type { Route } from "./+types/highlight.public"

/** GET /h/:publicId — a shared highlight, for anyone with the link. */
export async function loader({ params, request, context }: Route.LoaderArgs) {
	const share = await getPublicShare(params.publicId)
	if (!share) throw data(null, { status: 404 })
	// Taken down by an admin, the page says so: not that its author did.
	if (share.status === "removed") throw data({ removed: true }, { status: 410 })
	if (share.status === "stopped") throw data(null, { status: 410 })
	const path = sharePath(params.publicId)
	if (new URL(request.url).pathname !== path) throw redirect(path, 301)
	const { snapshot } = share
	const t = getInstance(context).getFixedT(snapshot.locale, "editions")
	const title = snapshot.article.title ?? safeHost(snapshot.article.url)
	return {
		id: params.publicId,
		snapshot,
		labels: {
			readArticle: t("shared.readArticle"),
			noteLabel: t("shared.noteLabel"),
			madeWith: t("public.madeWith"),
			report: t("public.report"),
			terms: t("public.terms"),
			privacy: t("public.privacy"),
		},
		reportHref: `${path}/report`,
		url: `${env.APP_URL}${path}`,
		title: t("shared.title", { title }),
		description: t("shared.description", { title }),
		imageAlt: t("shared.pictureAlt"),
		// Its own picture, at an address that changes with each update. A quote in a script the font
		// lacks gets the Klipstack card.
		image: canDrawHighlight(snapshot.exact)
			? `${env.APP_URL}${path}/og.png?v=${share.updatedAt.getTime().toString(36)}`
			: shareCard(snapshot.locale).url,
	}
}

/**
 * Unlisted: kept out of search results. Sites a reader clicks through to see this site, never the
 * page's address.
 */
export function headers() {
	return {
		"X-Robots-Tag": "noindex",
		"Referrer-Policy": "strict-origin-when-cross-origin",
	}
}

/** The page speaks the sharer's language, whoever visits. */
export const handle: PageLanguage = {
	lang: (loaderData) =>
		(loaderData as Route.ComponentProps["loaderData"] | undefined)?.snapshot.locale,
}

export function meta({ loaderData }: Route.MetaArgs) {
	const noindex = { name: "robots", content: "noindex" }
	if (!loaderData) return [{ title: "Klipstack" }, noindex]
	const { title, description, url, image, imageAlt } = loaderData
	return [
		{ title },
		noindex,
		{ name: "description", content: description },
		{ property: "og:type", content: "article" },
		{ property: "og:site_name", content: "Klipstack" },
		{ property: "og:title", content: title },
		{ property: "og:description", content: description },
		{ property: "og:url", content: url },
		{ property: "og:image", content: image },
		{ property: "og:image:width", content: String(CARD_WIDTH) },
		{ property: "og:image:height", content: String(CARD_HEIGHT) },
		{ property: "og:image:alt", content: imageAlt },
		{ name: "twitter:card", content: "summary_large_image" },
	]
}

export default function SharedHighlight({ loaderData }: Route.ComponentProps) {
	return (
		<SharedHighlightPage
			id={loaderData.id}
			snapshot={loaderData.snapshot}
			labels={loaderData.labels}
			reportHref={loaderData.reportHref}
		/>
	)
}
