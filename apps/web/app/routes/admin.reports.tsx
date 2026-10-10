import { useId } from "react"
import { useTranslation } from "react-i18next"
import { Link, useFetcher, useOutletContext } from "react-router"
import {
	ActionError,
	Card,
	ConfirmSubmit,
	Empty,
	PageHeader,
	RefreshButton,
	Table,
	useUtcTime,
} from "~/components/admin/ui"
import { Label } from "~/components/ui/label"
import { requireAdmin } from "~/lib/admin.server"
import { REMOVAL_NOTE_MAX, REPORT_REASONS } from "~/lib/edition-reports"
import { REPORTS_OPEN_MAX } from "~/lib/edition-reports.server"
import {
	type AdminRemovedEdition,
	type AdminReportedEdition,
	listRemovedEditions,
	listReportedEditions,
} from "~/services/admin-reports.server"
import type { Route } from "./+types/admin.reports"
import type { AdminOutletContext } from "./admin-layout"
import type { action as dismissAction } from "./admin.reports.dismiss"
import type { action as removeAction } from "./admin.reports.remove"
import type { action as restoreAction } from "./admin.reports.restore"

export async function loader({ context, request }: Route.LoaderArgs) {
	const ctx = await requireAdmin(context, request)
	const [reported, removed] = await Promise.all([
		listReportedEditions(ctx),
		listRemovedEditions(ctx),
	])
	return { reported, removed, max: REPORTS_OPEN_MAX, noteMax: REMOVAL_NOTE_MAX }
}

/** One fetcher per decision kind, shared: the edition's card is gone once it succeeds. */
const REMOVE = "edition-report-remove"
const DISMISS = "edition-report-dismiss"

function Decided() {
	const { t } = useTranslation("admin")
	const removed = useFetcher<typeof removeAction>({ key: REMOVE }).data
	const dismissed = useFetcher<typeof dismissAction>({ key: DISMISS }).data
	return (
		<>
			{removed?.ok ? (
				<p className="mb-4 text-sm" role="status">
					{t(removed.ownerEmailed ? "reports.removed" : "reports.removedNotEmailed", {
						count: removed.reportersEmailed,
					})}
				</p>
			) : null}
			{dismissed?.ok ? (
				<p className="mb-4 text-sm" role="status">
					{t("reports.dismissed", { count: dismissed.reportersEmailed })}
				</p>
			) : null}
		</>
	)
}

function ReportedEdition({
	edition,
	canWrite,
	noteMax,
}: {
	edition: AdminReportedEdition
	canWrite: boolean
	noteMax: number
}) {
	const { t } = useTranslation("admin")
	const time = useUtcTime()
	const remove = useFetcher<typeof removeAction>({ key: REMOVE })
	const dismiss = useFetcher<typeof dismissAction>({ key: DISMISS })
	const busy = remove.state !== "idle" || dismiss.state !== "idle"
	const groundId = useId()
	const noteId = useId()
	// The ground most reports gave, as a starting point.
	const counts = new Map<string, number>()
	for (const report of edition.reports)
		counts.set(report.reason, (counts.get(report.reason) ?? 0) + 1)
	const likely = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "other"
	return (
		<div className="mb-6" data-testid={`reported-${edition.publicId}`}>
			<Card title={t("reports.edition", { count: edition.count })}>
				<p className="mb-3 text-sm">
					<a
						href={`/e/${edition.publicId}`}
						target="_blank"
						rel="noreferrer"
						className="font-medium text-link"
					>
						{edition.title}
					</a>{" "}
					<span className="text-muted-fg">
						{t("reports.by")}{" "}
						<Link to={`/admin/users/${edition.owner.id}`} prefetch="none" className="text-link">
							{edition.owner.name || edition.owner.id}
						</Link>
					</span>
				</p>
				<Table
					caption={edition.title}
					head={[t("reports.reason"), t("reports.details"), t("reports.email"), t("reports.time")]}
				>
					{edition.reports.map((report) => (
						<tr key={report.id}>
							<td>{t(`reports.reasons.${report.reason}`)}</td>
							<td className="max-w-md whitespace-pre-wrap break-words">{report.details}</td>
							<td className="break-all">{report.email ?? "—"}</td>
							<td>{time(report.createdAt)}</td>
						</tr>
					))}
				</Table>
				{canWrite ? (
					<div className="mt-4 flex flex-col gap-4">
						<remove.Form
							method="post"
							action={`/admin/reports/${edition.id}/remove`}
							className="flex flex-col gap-2"
						>
							<div>
								<Label htmlFor={groundId}>{t("reports.ground")}</Label>
								<select
									id={groundId}
									name="ground"
									defaultValue={likely}
									className="block h-10 rounded-lg border border-border bg-bg px-3 text-sm"
								>
									{REPORT_REASONS.map((reason) => (
										<option key={reason} value={reason}>
											{t(`reports.reasons.${reason}`)}
										</option>
									))}
								</select>
							</div>
							<div>
								<Label htmlFor={noteId}>{t("reports.note")}</Label>
								<textarea
									id={noteId}
									name="note"
									rows={3}
									required
									maxLength={noteMax}
									aria-describedby={`${noteId}-hint`}
									className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm"
								/>
								<p id={`${noteId}-hint`} className="text-xs text-muted-fg">
									{t("reports.noteHint")}
								</p>
							</div>
							<div>
								<ConfirmSubmit
									label={t("reports.remove")}
									question={t("reports.removeConfirm")}
									busy={busy}
									variant="danger"
								/>
							</div>
						</remove.Form>
						<dismiss.Form method="post" action={`/admin/reports/${edition.id}/dismiss`}>
							<ConfirmSubmit
								label={t("reports.dismiss")}
								question={t("reports.dismissConfirm")}
								busy={busy}
							/>
						</dismiss.Form>
					</div>
				) : null}
				{remove.data && !remove.data.ok ? <ActionError code={remove.data.error.code} /> : null}
				{dismiss.data && !dismiss.data.ok ? <ActionError code={dismiss.data.error.code} /> : null}
			</Card>
		</div>
	)
}

function RemovedRow({ edition, canWrite }: { edition: AdminRemovedEdition; canWrite: boolean }) {
	const { t } = useTranslation("admin")
	const time = useUtcTime()
	const restore = useFetcher<typeof restoreAction>()
	return (
		<tr>
			<td>{edition.title}</td>
			<td>
				<Link to={`/admin/users/${edition.owner.id}`} prefetch="none" className="text-link">
					{edition.owner.name || edition.owner.id}
				</Link>
			</td>
			<td>{t(`reports.reasons.${edition.ground}`)}</td>
			<td className="max-w-md whitespace-pre-wrap break-words">{edition.note}</td>
			<td>{time(edition.removedAt)}</td>
			<td>
				{canWrite ? (
					<restore.Form method="post" action={`/admin/reports/${edition.id}/restore`}>
						<ConfirmSubmit
							label={t("reports.restore")}
							question={t("reports.restoreConfirm")}
							busy={restore.state !== "idle"}
						/>
					</restore.Form>
				) : null}
				{restore.data && !restore.data.ok ? <ActionError code={restore.data.error.code} /> : null}
			</td>
		</tr>
	)
}

export default function AdminReports({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("admin")
	const { canWrite } = useOutletContext<AdminOutletContext>()
	const { reported, removed, max, noteMax } = loaderData
	return (
		<>
			<PageHeader title={t("reports.title")}>
				<RefreshButton />
			</PageHeader>
			<p className="mb-4 text-sm text-muted-fg">{t("reports.hint", { max })}</p>
			<Decided />
			{reported.length ? (
				reported.map((edition) => (
					<ReportedEdition
						key={edition.id}
						edition={edition}
						canWrite={canWrite}
						noteMax={noteMax}
					/>
				))
			) : (
				<Empty>{t("reports.empty")}</Empty>
			)}
			<h2 className="mt-8 mb-3 font-semibold">{t("reports.removedTitle")}</h2>
			{removed.length ? (
				<Table
					caption={t("reports.removedTitle")}
					head={[
						t("reports.editionTitle"),
						t("reports.owner"),
						t("reports.ground"),
						t("reports.note"),
						t("reports.time"),
						"",
					]}
				>
					{removed.map((edition) => (
						<RemovedRow key={edition.id} edition={edition} canWrite={canWrite} />
					))}
				</Table>
			) : (
				<Empty>{t("reports.removedEmpty")}</Empty>
			)}
		</>
	)
}
