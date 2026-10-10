import { useTranslation } from "react-i18next"
import {
	Card,
	ObservedLine,
	PageHeader,
	Table,
	Unavailable,
	useAutoRefresh,
} from "~/components/admin/ui"
import { requireAdmin } from "~/lib/admin.server"
import { overview } from "~/services/admin-system.server"
import type { Route } from "./+types/admin.overview"

export async function loader({ context, request }: Route.LoaderArgs) {
	const ctx = await requireAdmin(context, request)
	return overview(ctx)
}

export default function AdminOverview({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("admin")
	const { stale } = useAutoRefresh(loaderData.observedAt)
	const { counts, queues } = loaderData
	const stat = (label: string, value: number | null, hint?: string) => (
		<Card title={label}>
			<p className="text-3xl font-semibold tabular-nums">
				{value === null ? <Unavailable /> : value.toLocaleString("en-US")}
			</p>
			{hint ? <p className="mt-1 text-xs text-muted-fg">{hint}</p> : null}
		</Card>
	)
	return (
		<>
			<PageHeader title={t("overview.title")}>
				<ObservedLine observedAt={loaderData.observedAt} stale={stale} />
			</PageHeader>
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
				{stat(t("overview.accounts"), counts.ok ? counts.value.accounts : null)}
				{stat(t("overview.verifiedAccounts"), counts.ok ? counts.value.verifiedAccounts : null)}
				{stat(
					t("overview.articles"),
					counts.ok ? counts.value.articles : null,
					t("overview.articlesHint"),
				)}
				{stat(t("overview.failedExtractions"), counts.ok ? counts.value.failedExtractions : null)}
			</div>
			<h2 className="mt-8 mb-3 text-lg font-semibold">{t("overview.queues")}</h2>
			{queues.ok ? (
				<>
					<Table
						caption={t("overview.queues")}
						head={[
							t("overview.queue"),
							t("overview.queued"),
							t("overview.active"),
							t("overview.failedRetained"),
						]}
					>
						{queues.value.map((queue) => (
							<tr key={queue.queue}>
								<td>{queue.queue}</td>
								<td className="tabular-nums">{queue.queued}</td>
								<td className="tabular-nums">{queue.active}</td>
								<td className="tabular-nums">{queue.failedRetained}</td>
							</tr>
						))}
					</Table>
					<p className="mt-2 text-xs text-muted-fg">{t("overview.failedRetainedHint")}</p>
				</>
			) : (
				<Unavailable />
			)}
		</>
	)
}
