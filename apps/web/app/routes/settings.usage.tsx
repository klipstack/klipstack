import { useTranslation } from "react-i18next"
import { SettingsCard, SettingsPage } from "~/components/settings-page"
import { formatDay } from "~/lib/date-groups"
import { aiOn } from "~/lib/features.server"
import { getLocale } from "~/lib/i18n.server"
import { type LimitName, usageOf } from "~/lib/limits.server"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { resolvePrefs } from "~/lib/prefs"
import { requireUser } from "~/lib/session.server"
import { cn } from "~/lib/utils"
import type { Route } from "./+types/settings.usage"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "settings:usage.title") }]
}

export const handle: PageBarHandle = { pageBar: { titleKey: "settings:usage.title" } }

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	const [usage, asking] = await Promise.all([usageOf(user.id), aiOn(user.id)])
	const editions = resolvePrefs(user.prefs).editions === "on"
	const locale = getLocale(context)
	// Numbers are formatted here, as dates are: the server's Intl and the browser's may differ.
	const number = new Intl.NumberFormat(locale)
	const shown = (name: LimitName, value: number) =>
		number.format(name === "storage" ? Math.round(value / (1024 * 1024)) : value)
	const limits: LimitName[] = [
		"saves",
		"storage",
		"feeds",
		// The features turned off in Settings → Features take nothing from their caps.
		...(editions ? ["editions" as const] : []),
		"shares",
		...(asking ? ["ai" as const] : []),
	]
	return {
		rows: limits.map((name) => ({
			name,
			used: shown(name, usage[name].used),
			max: shown(name, usage[name].max),
			percent: Math.min(100, Math.round((usage[name].used / usage[name].max) * 100)),
		})),
		// Midnight UTC on the 1st: in the reader's zone it may still be the day before.
		resetsOn: formatDay(usage.resetsAt, locale, "UTC"),
	}
}

/** Where the account stands against each of its caps (`lib/limits.server.ts`). */
export default function UsageSettings({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("settings")
	return (
		<SettingsPage
			title={t("usage.title")}
			description={t("usage.description", { date: loaderData.resetsOn })}
		>
			<SettingsCard>
				<ul className="flex flex-col gap-4">
					{loaderData.rows.map((row) => (
						<li key={row.name}>
							<div className="flex items-baseline justify-between gap-3 text-sm">
								<span>{t(`usage.${row.name}`)}</span>
								<span
									className={cn(
										"tabular-nums",
										row.percent >= 100 ? "text-danger" : "text-muted-fg",
									)}
								>
									{t(row.name === "storage" ? "usage.megabytes" : "usage.count", {
										used: row.used,
										max: row.max,
									})}
								</span>
							</div>
							<div
								role="progressbar"
								aria-label={t(`usage.${row.name}`)}
								aria-valuemin={0}
								aria-valuemax={100}
								aria-valuenow={row.percent}
								className="mt-1.5 h-1 overflow-hidden rounded-full bg-fg/10"
							>
								<div
									className={cn(
										"h-full rounded-full",
										row.percent >= 100 ? "bg-danger" : row.percent >= 80 ? "bg-warn" : "bg-accent",
									)}
									style={{ width: `${row.percent}%` }}
								/>
							</div>
						</li>
					))}
				</ul>
			</SettingsCard>
		</SettingsPage>
	)
}
