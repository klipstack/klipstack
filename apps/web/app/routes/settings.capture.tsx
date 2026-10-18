import { useTranslation } from "react-i18next"
import { SettingsCard, SettingsPage } from "~/components/settings-page"
import { env } from "~/lib/env.server"
import { extensionUrl } from "~/lib/extension-url"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { requireUser } from "~/lib/session.server"
import type { Route } from "./+types/settings.capture"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "settings:capture.title") }]
}

export const handle: PageBarHandle = { pageBar: { titleKey: "settings:capture.title" } }

export function loader({ context, request }: Route.LoaderArgs) {
	requireUser(context, request)
	return {
		appUrl: env.APP_URL,
		extensionUrl: extensionUrl(env.APP_URL),
	}
}

export default function CaptureSettings({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("settings")
	const bookmarklet = `javascript:(function(){location.href=${JSON.stringify(`${loaderData.appUrl}/add?url=`)}+encodeURIComponent(location.href)})()`
	const bookmarkletHtml = `<a href="${bookmarklet.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" class="inline-block rounded-lg border border-border bg-muted px-3 py-1.5 text-sm font-medium" draggable="true">${t("capture.bookmarklet.label")}</a>`
	return (
		<SettingsPage title={t("capture.title")}>
			<SettingsCard
				title={t("capture.extension.title")}
				description={t("capture.extension.description")}
			>
				<a
					href={loaderData.extensionUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="mt-2 inline-block text-sm text-link hover:underline"
				>
					{t("capture.extension.install")}
				</a>
			</SettingsCard>
			<SettingsCard
				title={t("capture.bookmarklet.title")}
				description={t("capture.bookmarklet.description")}
			>
				{/* oxlint-disable-next-line react/no-danger -- javascript: href for a bookmarklet, built from our own origin */}
				<p className="mt-2" dangerouslySetInnerHTML={{ __html: bookmarkletHtml }} />
			</SettingsCard>
			<SettingsCard
				title={t("capture.shortcut.title")}
				description={t("capture.shortcut.description")}
			>
				<ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
					<li>
						<code className="[overflow-wrap:anywhere]">{t("capture.shortcut.step1")}</code>
					</li>
					<li>
						<code className="[overflow-wrap:anywhere]">
							{t("capture.shortcut.step2", { url: `${loaderData.appUrl}/api/v1/articles` })}
						</code>
					</li>
					<li>{t("capture.shortcut.step3")}</li>
					<li>{t("capture.shortcut.step4")}</li>
				</ol>
				<p className="mt-2 text-sm text-muted-fg">{t("capture.shortcut.note")}</p>
			</SettingsCard>
		</SettingsPage>
	)
}
