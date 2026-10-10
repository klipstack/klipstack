import { useTranslation } from "react-i18next"
import {
	Badge,
	Card,
	Mono,
	ObservedLine,
	PageHeader,
	Table,
	Unavailable,
	useAutoRefresh,
	useUtcTime,
} from "~/components/admin/ui"
import { requireAdmin } from "~/lib/admin.server"
import { systemStatus } from "~/services/admin-system.server"
import type { Route } from "./+types/admin.system"

export async function loader({ context, request }: Route.LoaderArgs) {
	const ctx = await requireAdmin(context, request)
	return systemStatus(ctx)
}

export default function AdminSystem({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("admin")
	const time = useUtcTime()
	const { stale } = useAutoRefresh(loaderData.observedAt)
	const { database, worker, queues, deployment, links } = loaderData
	const age = (seconds: number | null) =>
		seconds === null ? t("common.none") : t("system.seconds", { count: seconds })
	return (
		<>
			<PageHeader title={t("system.title")}>
				<ObservedLine observedAt={loaderData.observedAt} stale={stale} />
			</PageHeader>
			<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
				<Card title={t("system.database")}>
					{database.ok ? (
						<p>
							<Badge tone="good">{t("system.databaseOk")}</Badge>{" "}
							<span className="text-sm text-muted-fg">{time(database.value.checkedAt)}</span>
						</p>
					) : (
						<Unavailable />
					)}
					<p className="mt-2 text-xs text-muted-fg">{t("system.databaseHint")}</p>
				</Card>
				<Card title={t("system.worker")}>
					{worker.ok ? (
						<div data-testid="worker-state" data-state={worker.value.state}>
							<Badge
								tone={
									worker.value.state === "recent"
										? "good"
										: worker.value.state === "stale"
											? "bad"
											: "neutral"
								}
							>
								{t(`system.workerState.${worker.value.state}`)}
							</Badge>
							{worker.value.lastSeenAt ? (
								<dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
									<dt className="text-muted-fg">{t("system.lastSeen")}</dt>
									<dd>{time(worker.value.lastSeenAt)}</dd>
									<dt className="text-muted-fg">{t("system.startedAt")}</dt>
									<dd>{time(worker.value.startedAt)}</dd>
									<dt className="text-muted-fg">{t("system.instance")}</dt>
									<dd>
										<Mono>{worker.value.instanceId}</Mono>
									</dd>
								</dl>
							) : null}
						</div>
					) : (
						<Unavailable />
					)}
					<p className="mt-2 text-xs text-muted-fg">{t("system.workerHint")}</p>
				</Card>
				<Card title={t("system.deployment")}>
					<dl className="grid grid-cols-[10rem_1fr] gap-y-1 text-sm">
						<dt className="text-muted-fg">{t("system.version")}</dt>
						<dd>
							<Mono>{deployment.version}</Mono>
						</dd>
						<dt className="text-muted-fg">{t("system.storage")}</dt>
						<dd>
							<Mono>{deployment.storage}</Mono>
						</dd>
					</dl>
					<p className="mt-2 text-xs text-muted-fg">{t("system.storageHint")}</p>
				</Card>
				<Card title={t("system.operations")}>
					<ul className="flex flex-col gap-1 text-sm">
						{(["uptime", "backups", "cloudflare"] as const).map((key) => (
							<li key={key}>
								<a
									href={links[key]}
									target="_blank"
									rel="noreferrer noopener"
									className="text-link hover:underline"
								>
									{t(`system.links.${key}`)}
								</a>
							</li>
						))}
					</ul>
					<p className="mt-2 text-xs text-muted-fg">{t("system.backupsHint")}</p>
				</Card>
			</div>
			<h2 className="mt-8 mb-3 text-lg font-semibold">{t("overview.queues")}</h2>
			{queues.ok ? (
				<Table
					caption={t("overview.queues")}
					head={[
						t("overview.queue"),
						t("overview.queued"),
						t("system.oldestQueued"),
						t("overview.active"),
						t("system.oldestActive"),
					]}
				>
					{queues.value.map((queue) => (
						<tr key={queue.queue}>
							<td>{queue.queue}</td>
							<td className="tabular-nums">{queue.queued}</td>
							<td className="tabular-nums">{age(queue.oldestQueuedSeconds)}</td>
							<td className="tabular-nums">{queue.active}</td>
							<td className="tabular-nums">{age(queue.oldestActiveSeconds)}</td>
						</tr>
					))}
				</Table>
			) : (
				<Unavailable />
			)}
		</>
	)
}
