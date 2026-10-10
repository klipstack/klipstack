import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher, useRouteLoaderData } from "react-router"
import { SettingsCard, SettingsPage } from "~/components/settings-page"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { requireUser } from "~/lib/session.server"
import type { loader as rootLoader } from "~/root"
import type { Route } from "./+types/settings.shortcuts"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "settings:shortcuts.title") }]
}

export const handle: PageBarHandle = { pageBar: { titleKey: "settings:shortcuts.title" } }

export function loader({ context, request }: Route.LoaderArgs) {
	requireUser(context, request)
	return null
}

/** Single-key shortcuts on or off. Saved to the prefs; the root sets `data-shortcuts` from them. */
export default function ShortcutsSettings() {
	const { t } = useTranslation("settings")
	const fetcher = useFetcher()
	const root = useRouteLoaderData<typeof rootLoader>("root")
	const [on, setOn] = useState(!root?.shortcutsOff)
	return (
		<SettingsPage title={t("shortcuts.title")} description={t("shortcuts.description")}>
			<SettingsCard>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						checked={on}
						onChange={(e) => {
							setOn(e.target.checked)
							void fetcher.submit(
								{ shortcuts: e.target.checked ? "on" : "off" },
								{ method: "post", action: "/prefs" },
							)
						}}
					/>
					{t("shortcuts.singleKey")}
				</label>
			</SettingsCard>
		</SettingsPage>
	)
}
