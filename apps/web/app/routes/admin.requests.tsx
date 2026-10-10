import { useTranslation } from "react-i18next"
import { useFetcher, useOutletContext } from "react-router"
import {
	ActionError,
	ConfirmSubmit,
	CopyCode,
	Empty,
	PageHeader,
	Pager,
	RefreshButton,
	Table,
	useUtcTime,
} from "~/components/admin/ui"
import { requireAdmin } from "~/lib/admin.server"
import { env } from "~/lib/env.server"
import { INVITE_REQUEST_PENDING_MAX } from "~/lib/invite-requests.server"
import {
	type AdminInviteRequest,
	listInviteRequests,
	REQUEST_INVITE_DAYS,
} from "~/services/admin-invite-requests.server"
import type { Route } from "./+types/admin.requests"
import type { AdminOutletContext } from "./admin-layout"
import type { action as approveAction } from "./admin.requests.approve"
import type { action as dismissAction } from "./admin.requests.dismiss"

export async function loader({ context, request }: Route.LoaderArgs) {
	const ctx = await requireAdmin(context, request)
	const cursor = new URL(request.url).searchParams.get("cursor")
	return {
		open: env.SIGNUP_MODE === "waitlist",
		max: INVITE_REQUEST_PENDING_MAX,
		inviteDays: REQUEST_INVITE_DAYS,
		...(await listInviteRequests(ctx, { cursor })),
	}
}

/**
 * One fetcher for every row's approval: the row is gone once it succeeds, and the answer (the code,
 * whether the email went out) must outlive it. One approval at a time.
 */
const APPROVE = "invite-request-approve"

function Approved() {
	const { t } = useTranslation("admin")
	const result = useFetcher<typeof approveAction>({ key: APPROVE }).data
	if (!result) return null
	if (!result.ok) return <ActionError code={result.error.code} />
	return (
		<p
			className={
				result.emailed
					? "mb-4 flex flex-wrap items-center gap-2 text-sm"
					: "mb-4 flex flex-wrap items-center gap-2 text-sm text-danger"
			}
			role="status"
		>
			{t(result.emailed ? "requests.emailed" : "requests.notEmailed", { email: result.email })}
			<strong className="font-mono" data-testid="request-invite-code">
				{result.code}
			</strong>
			<CopyCode code={result.code} />
		</p>
	)
}

function RequestRow({
	request,
	canWrite,
	inviteDays,
}: {
	request: AdminInviteRequest
	canWrite: boolean
	inviteDays: number
}) {
	const { t } = useTranslation("admin")
	const time = useUtcTime()
	const approve = useFetcher<typeof approveAction>({ key: APPROVE })
	const dismiss = useFetcher<typeof dismissAction>()
	const busy = approve.state !== "idle" || dismiss.state !== "idle"
	return (
		<tr data-testid={`request-${request.id}`}>
			<td className="break-all">{request.email}</td>
			<td className="max-w-md whitespace-pre-wrap break-words">{request.note}</td>
			<td>{request.locale}</td>
			<td>{time(request.createdAt)}</td>
			<td>
				{canWrite ? (
					<div className="flex flex-wrap gap-2">
						<approve.Form method="post" action={`/admin/requests/${request.id}/approve`}>
							<ConfirmSubmit
								label={t("requests.approve")}
								question={t("requests.approveConfirm", { days: inviteDays })}
								busy={busy}
							/>
						</approve.Form>
						<dismiss.Form method="post" action={`/admin/requests/${request.id}/dismiss`}>
							<ConfirmSubmit
								label={t("requests.dismiss")}
								question={t("requests.dismissConfirm")}
								busy={busy}
								variant="danger"
							/>
						</dismiss.Form>
					</div>
				) : null}
				{dismiss.data && !dismiss.data.ok ? <ActionError code={dismiss.data.error.code} /> : null}
			</td>
		</tr>
	)
}

export default function AdminRequests({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("admin")
	const { canWrite } = useOutletContext<AdminOutletContext>()
	const { open, max, inviteDays, pending, requests, nextCursor } = loaderData
	return (
		<>
			<PageHeader title={t("requests.title")}>
				<RefreshButton />
			</PageHeader>
			<p className="mb-4 text-sm text-muted-fg">
				{open ? t("requests.waiting", { count: pending, max }) : t("requests.closed")}
			</p>
			<Approved />
			{requests.length ? (
				<Table
					caption={t("requests.title")}
					head={[
						t("requests.address"),
						t("requests.note"),
						t("requests.language"),
						t("requests.createdAt"),
						"",
					]}
				>
					{requests.map((request) => (
						<RequestRow
							key={request.id}
							request={request}
							canWrite={canWrite}
							inviteDays={inviteDays}
						/>
					))}
				</Table>
			) : (
				<Empty>{t("requests.empty")}</Empty>
			)}
			<Pager path="/admin/requests" nextCursor={nextCursor} />
		</>
	)
}
