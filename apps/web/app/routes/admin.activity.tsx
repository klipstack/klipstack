import { useTranslation } from "react-i18next"
import { Card, PageHeader, RefreshButton, Table } from "~/components/admin/ui"
import { ACTIVITY_DAYS } from "~/lib/admin-constants"
import { requireAdmin } from "~/lib/admin.server"
import { cn } from "~/lib/utils"
import { listActivity } from "~/services/admin-activity.server"
import type { Route } from "./+types/admin.activity"

export async function loader({ context, request }: Route.LoaderArgs) {
	const ctx = await requireAdmin(context, request)
	const days = await listActivity(ctx)
	const total = (key: "saved" | "highlighted" | "finished") =>
		days.reduce((sum, day) => sum + day[key], 0)
	return {
		days,
		totals: {
			saved: total("saved"),
			highlighted: total("highlighted"),
			finished: total("finished"),
		},
	}
}

const COUNTS = ["saved", "highlighted", "finished", "people"] as const

export default function AdminActivity({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("admin")
	const { days, totals } = loaderData
	return (
		<>
			<PageHeader title={t("activity.title")}>
				<RefreshButton />
			</PageHeader>
			<p className="mb-4 text-sm text-muted-fg">
				{t("activity.description", { count: ACTIVITY_DAYS })}
			</p>
			<div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
				{(["saved", "highlighted", "finished"] as const).map((key) => (
					<Card key={key} title={t(`activity.${key}`)}>
						<p className="text-3xl font-semibold tabular-nums">{totals[key]}</p>
						<p className="mt-1 text-xs text-muted-fg">
							{t("activity.inDays", { count: ACTIVITY_DAYS })}
						</p>
					</Card>
				))}
			</div>
			<Table
				caption={t("activity.title")}
				head={[t("activity.day"), ...COUNTS.map((key) => t(`activity.${key}`))]}
			>
				{days.map((day) => (
					<tr key={day.day}>
						<td className="tabular-nums">{day.day}</td>
						{COUNTS.map((key) => (
							<td key={key} className={cn("tabular-nums", !day[key] && "text-muted-fg")}>
								{day[key]}
							</td>
						))}
					</tr>
				))}
			</Table>
			<p className="mt-2 text-xs text-muted-fg">{t("activity.note")}</p>
		</>
	)
}
