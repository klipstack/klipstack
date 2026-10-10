import { resources } from "@klipstack/i18n"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import {
	Empty,
	Mono,
	PageHeader,
	Pager,
	RefreshButton,
	Table,
	useUtcTime,
} from "~/components/admin/ui"
import { requireAdmin } from "~/lib/admin.server"
import { isKeyOf } from "~/lib/i18n-keys"
import { listAuditEvents } from "~/services/admin-audit-list.server"
import type { Route } from "./+types/admin.audit"

export async function loader({ context, request }: Route.LoaderArgs) {
	const ctx = await requireAdmin(context, request)
	return listAuditEvents(ctx, { cursor: new URL(request.url).searchParams.get("cursor") })
}

export default function AdminAudit({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("admin")
	const time = useUtcTime()
	return (
		<>
			<PageHeader title={t("audit.title")}>
				<RefreshButton />
			</PageHeader>
			<p className="mb-4 text-sm text-muted-fg">{t("audit.hint")}</p>
			{loaderData.events.length ? (
				<Table
					caption={t("audit.title")}
					head={[
						t("audit.time"),
						t("audit.actor"),
						t("audit.action"),
						t("audit.target"),
						t("audit.details"),
					]}
				>
					{loaderData.events.map((event) => (
						<tr key={event.id}>
							<td className="whitespace-nowrap">{time(event.createdAt)}</td>
							<td>
								{event.actorKind === "operator-cli" ? (
									t("audit.operator")
								) : event.actor ? (
									<Link to={`/admin/users/${event.actor.id}`} prefetch="none" className="text-link">
										{event.actor.name}
									</Link>
								) : (
									t("audit.deletedAccount")
								)}
							</td>
							<td>
								{isKeyOf(resources.en.admin.audit.actions, event.action)
									? t(`audit.actions.${event.action}`)
									: event.action}
							</td>
							<td>
								{event.targetKind} <Mono>{event.targetId}</Mono>
							</td>
							<td>
								<dl className="text-xs">
									{Object.entries(event.metadata).map(([key, value]) => (
										<div key={key} className="flex gap-1">
											<dt className="text-muted-fg">{key}:</dt>
											<dd className="break-all">{String(value)}</dd>
										</div>
									))}
									<div className="flex gap-1">
										<dt className="text-muted-fg">{t("audit.correlation")}:</dt>
										<dd className="break-all">{event.correlationId}</dd>
									</div>
								</dl>
							</td>
						</tr>
					))}
				</Table>
			) : (
				<Empty>{t("audit.empty")}</Empty>
			)}
			<Pager path="/admin/audit" nextCursor={loaderData.nextCursor} />
		</>
	)
}
