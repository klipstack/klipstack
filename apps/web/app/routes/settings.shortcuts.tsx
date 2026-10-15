import { useId, useState } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher, useRouteLoaderData } from "react-router"
import { SettingsCard, SettingsPage } from "~/components/settings-page"
import { ShortcutList } from "~/components/shortcut-list"
import { ai } from "~/lib/ai.server"
import { hasFeature } from "~/lib/features.server"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { requireUser } from "~/lib/session.server"
import type { loader as rootLoader } from "~/root"
import type { Route } from "./+types/settings.shortcuts"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "settings:shortcuts.title") }]
}

export const handle: PageBarHandle = { pageBar: { titleKey: "settings:shortcuts.title" } }

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	// The AI's keys are listed to those who have it.
	return { ai: ai.available && (await hasFeature(user.id, "ai")) }
}

/**
 * Single-key shortcuts on or off, and the list of every shortcut. Saved to the prefs; the root sets
 * `data-shortcuts` from them.
 */
export default function ShortcutsSettings({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("settings")
	const fetcher = useFetcher()
	const root = useRouteLoaderData<typeof rootLoader>("root")
	const [on, setOn] = useState(!root?.shortcutsOff)
	const helpId = useId()
	return (
		<SettingsPage title={t("shortcuts.title")}>
			<SettingsCard>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						aria-describedby={helpId}
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
				<p id={helpId} className="mt-2 text-sm text-muted-fg">
					{t("shortcuts.description")}
				</p>
			</SettingsCard>
			<SettingsCard>
				<ShortcutList ai={loaderData.ai} off={!on} />
			</SettingsCard>
		</SettingsPage>
	)
}
