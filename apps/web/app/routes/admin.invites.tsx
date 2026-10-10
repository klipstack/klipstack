import { useTranslation } from "react-i18next"
import { Form, Link, useFetcher, useNavigation, useOutletContext, useSubmit } from "react-router"
import {
	ActionError,
	Badge,
	ConfirmSubmit,
	CopyCode,
	Empty,
	PageHeader,
	Pager,
	RefreshButton,
	Table,
	useUtcTime,
} from "~/components/admin/ui"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { INVITE_EXPIRIES, INVITE_STATUSES, type InviteStatus } from "~/lib/admin-constants"
import { requireAdmin } from "~/lib/admin.server"
import { type AdminInvite, listInvites } from "~/services/admin-invites.server"
import type { Route } from "./+types/admin.invites"
import type { AdminOutletContext } from "./admin-layout"
import type { action as createAction } from "./admin.invites.create"
import type { action as revokeAction } from "./admin.invites.revoke"

export async function loader({ context, request }: Route.LoaderArgs) {
	const ctx = await requireAdmin(context, request)
	const url = new URL(request.url)
	const raw = url.searchParams.get("status")
	const status = (INVITE_STATUSES as readonly string[]).includes(raw ?? "")
		? (raw as InviteStatus)
		: null
	return { status, ...(await listInvites(ctx, { status, cursor: url.searchParams.get("cursor") })) }
}

function CreateInvite() {
	const { t } = useTranslation("admin")
	const fetcher = useFetcher<typeof createAction>()
	const result = fetcher.data
	return (
		<section className="mb-8 rounded-xl border border-border bg-card p-4">
			<h2 className="mb-3 font-semibold">{t("invites.create")}</h2>
			<fetcher.Form
				method="post"
				action="/admin/invites/create"
				className="flex flex-wrap items-end gap-3"
			>
				<div className="min-w-56 flex-1">
					<Label htmlFor="invite-note">{t("invites.note")}</Label>
					<Input id="invite-note" name="note" maxLength={200} aria-describedby="invite-note-hint" />
				</div>
				<div>
					<Label htmlFor="invite-expiry">{t("invites.expiry")}</Label>
					<select
						id="invite-expiry"
						name="expiry"
						defaultValue="7d"
						className="block h-10 rounded-lg border border-border bg-bg px-3 text-sm"
					>
						{INVITE_EXPIRIES.map((value) => (
							<option key={value} value={value}>
								{t(`invites.expiryOptions.${value}`)}
							</option>
						))}
					</select>
				</div>
				<Button type="submit" disabled={fetcher.state !== "idle"}>
					{t("invites.create")}
				</Button>
			</fetcher.Form>
			{/* Below the row, not inside the note's column: the three controls share one baseline. */}
			<p id="invite-note-hint" className="mt-1 text-xs text-muted-fg">
				{t("invites.noteHint")}
			</p>
			{result?.ok ? (
				<p className="mt-3 flex flex-wrap items-center gap-2 text-sm" role="status">
					{t("invites.created")}
					<strong className="font-mono" data-testid="new-invite-code">
						{result.code}
					</strong>
					<CopyCode code={result.code} />
				</p>
			) : (
				<div className="mt-3">
					<ActionError code={result?.ok === false ? result.error.code : null} />
				</div>
			)}
		</section>
	)
}

function InviteRow({ invite, canWrite }: { invite: AdminInvite; canWrite: boolean }) {
	const { t } = useTranslation("admin")
	const time = useUtcTime()
	const fetcher = useFetcher<typeof revokeAction>()
	const revocable = canWrite && (invite.status === "active" || invite.status === "expired")
	const tone = invite.status === "active" ? "good" : invite.status === "revoked" ? "bad" : "neutral"
	return (
		<tr data-testid={`invite-${invite.id}`}>
			<td>
				<span className="font-mono">{invite.code}</span>
				{invite.status === "active" ? <CopyCode code={invite.code} /> : null}
			</td>
			<td>{invite.note}</td>
			<td>
				<Badge tone={tone}>{t(`invites.status.${invite.status}`)}</Badge>
			</td>
			<td>
				{invite.createdBy ? (
					<Link to={`/admin/users/${invite.createdBy.id}`} prefetch="none" className="text-link">
						{invite.createdBy.name}
					</Link>
				) : (
					t("invites.operator")
				)}
			</td>
			<td>{time(invite.createdAt)}</td>
			<td>{time(invite.expiresAt) ?? t("common.never")}</td>
			<td>
				{invite.usedBy ? (
					<Link to={`/admin/users/${invite.usedBy.id}`} prefetch="none" className="text-link">
						{invite.usedBy.name}
					</Link>
				) : invite.status === "used" ? (
					t("invites.deletedAccount")
				) : null}
			</td>
			<td>
				{revocable ? (
					<fetcher.Form method="post" action={`/admin/invites/${invite.id}/revoke`}>
						<ConfirmSubmit
							label={t("invites.revoke")}
							question={t("invites.revokeConfirm")}
							busy={fetcher.state !== "idle"}
							variant="danger"
						/>
					</fetcher.Form>
				) : null}
				{fetcher.data && !fetcher.data.ok ? <ActionError code={fetcher.data.error.code} /> : null}
			</td>
		</tr>
	)
}

export default function AdminInvites({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("admin")
	const { canWrite } = useOutletContext<AdminOutletContext>()
	const submit = useSubmit()
	// The choice on its way, then the one the URL holds: the select follows Back and links too, and
	// is never remounted, so a keyboard user keeps focus while stepping through the statuses.
	const next = useNavigation().location
	const pendingStatus =
		next?.pathname === "/admin/invites" ? new URLSearchParams(next.search).get("status") : null
	return (
		<>
			<PageHeader title={t("invites.title")}>
				<RefreshButton />
			</PageHeader>
			{canWrite ? <CreateInvite /> : null}
			<Form method="get" className="mb-4 flex items-end gap-2">
				<div>
					<Label htmlFor="invite-status">{t("invites.filter")}</Label>
					<select
						id="invite-status"
						name="status"
						value={pendingStatus ?? loaderData.status ?? ""}
						onChange={(event) => submit(event.currentTarget.form)}
						className="block h-10 rounded-lg border border-border bg-bg px-3 text-sm"
					>
						<option value="">{t("invites.all")}</option>
						{INVITE_STATUSES.map((status) => (
							<option key={status} value={status}>
								{t(`invites.status.${status}`)}
							</option>
						))}
					</select>
				</div>
				{/* Choosing a status applies it. The button is only for a browser without scripts. */}
				<noscript>
					<Button type="submit" variant="secondary">
						{t("invites.filter")}
					</Button>
				</noscript>
			</Form>
			{loaderData.invites.length ? (
				<Table
					caption={t("invites.title")}
					head={[
						t("invites.code"),
						t("invites.note"),
						t("invites.filter"),
						t("invites.createdBy"),
						t("invites.createdAt"),
						t("invites.expiresAt"),
						t("invites.usedBy"),
						"",
					]}
				>
					{loaderData.invites.map((invite) => (
						<InviteRow key={invite.id} invite={invite} canWrite={canWrite} />
					))}
				</Table>
			) : (
				<Empty>{t("invites.empty")}</Empty>
			)}
			<Pager
				path="/admin/invites"
				nextCursor={loaderData.nextCursor}
				params={{ status: loaderData.status }}
			/>
		</>
	)
}
