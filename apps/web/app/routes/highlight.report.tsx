import { data } from "react-router"
import { reportShare } from "~/lib/edition-reports.server"
import { getInstance, getLocale } from "~/lib/i18n.server"
import { safeHost } from "~/lib/site-label"
import { getPublicShare, sharePath } from "~/services/highlight-shares.server"
import type { Route } from "./+types/highlight.report"
import { reportAction, reportLoader } from "./edition.report"

export { default, meta } from "./edition.report"

/** The shared highlight the form is about: live. Anything else is gone. */
async function liveShare(publicId: string) {
	const share = await getPublicShare(publicId)
	if (!share) throw data(null, { status: 404 })
	if (share.status === "removed") throw data({ removed: true }, { status: 410 })
	if (share.status === "stopped") throw data(null, { status: 410 })
	return share.snapshot
}

/** GET /h/:publicId/report — anyone may report a shared highlight, with the editions' form. */
export async function loader({ params, context }: Route.LoaderArgs) {
	const snapshot = await liveShare(params.publicId)
	// Named by its article, as the page's credit line names it.
	const title = snapshot.article.title ?? safeHost(snapshot.article.url)
	return reportLoader(getInstance(context).t("editions:report.title"), {
		title,
		path: sharePath(params.publicId),
	})
}

export function action({ request, context, params }: Route.ActionArgs) {
	return reportAction(request, getLocale(context), (input) =>
		reportShare({ ...input, publicId: params.publicId }, request.headers),
	)
}
