import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { SettingsCard, SettingsPage } from "~/components/settings-page"
import { useAppVersion } from "~/lib/app-version"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { requireUser } from "~/lib/session.server"
import type { Route } from "./+types/settings.about"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "settings:about.title") }]
}

export const handle: PageBarHandle = { pageBar: { titleKey: "settings:about.title" } }

export function loader({ context, request }: Route.LoaderArgs) {
	requireUser(context, request)
	return null
}

export default function AboutSettings() {
	const { t } = useTranslation("settings")
	const { t: tc } = useTranslation()
	return (
		<SettingsPage title={t("about.title")} description={t("about.description")}>
			<SettingsCard>
				<AppVersion />
				<nav
					aria-label={tc("home.footer.label")}
					className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-fg"
				>
					<Link to="/terms" className="hover:text-fg hover:underline">
						{tc("home.footer.terms")}
					</Link>
					<Link to="/privacy" className="hover:text-fg hover:underline">
						{tc("home.footer.privacy")}
					</Link>
					<Link to="/support" className="hover:text-fg hover:underline">
						{tc("home.footer.support")}
					</Link>
				</nav>
			</SettingsCard>
		</SettingsPage>
	)
}

/** The commit this page is running, and a way back to a newer one once it is live. */
function AppVersion() {
	const { t } = useTranslation("settings")
	const { version, stale } = useAppVersion()
	return (
		<div className="flex flex-wrap items-center gap-3">
			<code className="rounded-lg bg-muted px-2 py-1 text-sm">{version || "dev"}</code>
			{stale ? (
				<button
					type="button"
					onClick={() => window.location.reload()}
					className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg"
				>
					{t("about.update")}
				</button>
			) : null}
		</div>
	)
}
