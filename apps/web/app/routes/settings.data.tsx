import { useTranslation } from "react-i18next"
import { SettingsCard, SettingsPage } from "~/components/settings-page"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { requireUser } from "~/lib/session.server"
import type { Route } from "./+types/settings.data"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "settings:data.title") }]
}

export const handle: PageBarHandle = { pageBar: { titleKey: "settings:data.title" } }

export function loader({ context, request }: Route.LoaderArgs) {
	requireUser(context, request)
	return null
}

export default function DataSettings() {
	const { t } = useTranslation("settings")
	return (
		<SettingsPage title={t("data.title")} description={t("data.description")}>
			<SettingsCard>
				<div className="flex flex-wrap gap-2">
					<a
						href="/export?format=zip"
						className="rounded-lg bg-muted px-3 py-2 text-sm font-medium hover:bg-border"
						download
					>
						{t("data.zip")}
					</a>
					<a
						href="/export?format=json"
						className="rounded-lg bg-muted px-3 py-2 text-sm font-medium hover:bg-border"
						download
					>
						{t("data.json")}
					</a>
				</div>
			</SettingsCard>
		</SettingsPage>
	)
}
