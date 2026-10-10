import { ArrowLeft } from "lucide-react"
import { useTranslation } from "react-i18next"
import { data, Link } from "react-router"
import { EditionPage } from "~/components/edition-page"
import { AppError } from "~/lib/app-error"
import { getInstance } from "~/lib/i18n.server"
import type { PageBarHandle } from "~/lib/page-bar"
import { requireUser } from "~/lib/session.server"
import { getEdition, previewView } from "~/services/editions.server"
import type { Route } from "./+types/editions.preview"

export function meta({ loaderData }: Route.MetaArgs) {
	return [{ title: `${loaderData?.view.title || "Edition"} · Klipstack` }]
}

export const handle: PageBarHandle = { pageBar: { titleKey: "common:nav.editions" } }

/**
 * GET /editions/:id/preview — the working copy as the public page would show it once published:
 * the same snapshot, built now, and the same component. Owner only.
 */
export async function loader({ params, context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	const { edition, items } = await getEdition(user.id, params.id).catch((error: unknown) => {
		if (error instanceof AppError && error.code === "not_found") throw data(null, { status: 404 })
		throw error
	})
	const t = getInstance(context).getFixedT(edition.locale, "editions")
	return { id: edition.id, view: await previewView(user.id, edition, items, user.name, t) }
}

export default function EditionPreview({ loaderData }: Route.ComponentProps) {
	const { t, i18n } = useTranslation("editions")
	return (
		<EditionPage
			view={loaderData.view}
			banner={
				<div
					role="status"
					lang={i18n.language}
					className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted px-4 py-2 text-sm"
				>
					<span className="font-medium">{t("preview.banner")}</span>
					<Link
						to={`/editions/${loaderData.id}`}
						className="inline-flex items-center gap-1 text-link hover:underline"
					>
						<ArrowLeft className="size-4" aria-hidden />
						{t("preview.back")}
					</Link>
				</div>
			}
		/>
	)
}
