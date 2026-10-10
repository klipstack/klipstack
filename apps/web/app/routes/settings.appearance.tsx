import { useTranslation } from "react-i18next"
import { SettingsCard, SettingsPage } from "~/components/settings-page"
import { ThemePicker } from "~/components/theme-picker"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { requireUser } from "~/lib/session.server"
import type { Route } from "./+types/settings.appearance"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "settings:appearance.title") }]
}

export const handle: PageBarHandle = { pageBar: { titleKey: "settings:appearance.title" } }

export function loader({ context, request }: Route.LoaderArgs) {
	requireUser(context, request)
	return null
}

export default function AppearanceSettings() {
	const { t } = useTranslation("settings")
	return (
		<SettingsPage title={t("appearance.title")} description={t("appearance.description")}>
			<SettingsCard>
				<ThemePicker className="max-w-sm" />
			</SettingsCard>
		</SettingsPage>
	)
}
