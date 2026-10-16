import { Copy, Unplug } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher } from "react-router"
import { disconnectApp } from "~/commands/account.server"
import { SettingsCard, SettingsPage } from "~/components/settings-page"
import { Button } from "~/components/ui/button"
import { MCP_RESOURCE } from "~/lib/auth.server"
import { formatDay, timeZoneFromCookie } from "~/lib/date-groups"
import { getLocale } from "~/lib/i18n.server"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { answer } from "~/lib/web-action.server"
import { listConnectedApps } from "~/services/oauth-apps.server"
import type { Route } from "./+types/settings.connected-apps"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "settings:connectedApps.title") }]
}

export const handle: PageBarHandle = { pageBar: { titleKey: "settings:connectedApps.title" } }

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	const locale = getLocale(context)
	const zone = timeZoneFromCookie(request.headers.get("cookie"))
	const apps = await listConnectedApps(user.id)
	return {
		apps: apps.map((app) => ({
			...app,
			connectedOn: app.createdAt ? formatDay(app.createdAt, locale, zone) : null,
		})),
		mcpUrl: MCP_RESOURCE,
	}
}

/** POST /settings/connected-apps  intent=disconnect id=<consent id>. */
export async function action({ request, context }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const id = String((await readForm(request)).get("id") ?? "")
	return answer(async () => {
		await disconnectApp(user.id, id)
		return { disconnected: id }
	})
}

export default function ConnectedAppsSettings({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("settings")
	const { apps, mcpUrl } = loaderData
	const fetcher = useFetcher()
	const pending = fetcher.formData ? String(fetcher.formData.get("id")) : null
	const [copied, setCopied] = useState(false)
	const { t: tl } = useTranslation("library")
	const [promptCopied, setPromptCopied] = useState(false)
	return (
		<SettingsPage title={t("connectedApps.title")} description={t("connectedApps.description")}>
			<SettingsCard>
				<p className="text-sm">{t("connectedApps.mcpHint")}</p>
				<div className="mt-2 flex items-center gap-2">
					<code
						data-testid="mcp-url"
						className="flex-1 overflow-x-auto rounded bg-muted px-2 py-1 text-sm"
					>
						{mcpUrl}
					</code>
					<Button
						type="button"
						size="sm"
						variant="secondary"
						onClick={() => {
							void navigator.clipboard?.writeText(mcpUrl).then(() => setCopied(true))
						}}
					>
						<Copy className="size-4" aria-hidden />
						{copied ? t("apiKeys.copied") : t("apiKeys.copy")}
					</Button>
				</div>
				{/* The same prompt as the Save link dialog's: the assistant sets itself up, or says how. */}
				<p className="mt-4 text-sm text-muted-fg">{t("connectedApps.promptHint")}</p>
				<Button
					type="button"
					size="sm"
					variant="secondary"
					className="mt-2"
					onClick={() => {
						void navigator.clipboard
							?.writeText(tl("add.assistant.prompt", { url: mcpUrl }))
							.then(() => setPromptCopied(true))
					}}
				>
					<Copy className="size-4" aria-hidden />
					{promptCopied ? tl("add.assistant.copied") : tl("add.assistant.copy")}
				</Button>
				<ul className="mt-4 divide-y divide-border">
					{apps.length === 0 ? (
						<li className="py-2 text-sm text-muted-fg">{t("connectedApps.empty")}</li>
					) : null}
					{apps.map((app) => {
						const name = app.name || app.host || app.clientId
						return (
							<li
								key={app.id}
								className={`flex items-center justify-between gap-3 py-2 ${pending === app.id ? "opacity-40" : ""}`}
							>
								<div className="min-w-0">
									<p className="truncate text-sm font-medium">{name}</p>
									<p className="truncate text-xs text-muted-fg">
										{app.host && app.host !== name ? `${app.host} · ` : ""}
										{app.connectedOn
											? t("connectedApps.connectedOn", { date: app.connectedOn })
											: null}
									</p>
								</div>
								<fetcher.Form
									method="post"
									action="/settings/connected-apps"
									onSubmit={(e) => {
										if (!confirm(t("connectedApps.disconnectConfirm"))) e.preventDefault()
									}}
								>
									<input type="hidden" name="intent" value="disconnect" />
									<input type="hidden" name="id" value={app.id} />
									<Button
										type="submit"
										size="sm"
										variant="ghost"
										aria-label={`${t("connectedApps.disconnect")} ${name}`}
									>
										<Unplug className="size-4" aria-hidden />
										{t("connectedApps.disconnect")}
									</Button>
								</fetcher.Form>
							</li>
						)
					})}
				</ul>
			</SettingsCard>
		</SettingsPage>
	)
}
