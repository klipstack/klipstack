import { featureFlags } from "@klipstack/db"
import { useTranslation } from "react-i18next"
import { data, Link, useFetcher, useOutletContext } from "react-router"
import { ActionError, Badge, Card, Mono, PageHeader, useUtcTime } from "~/components/admin/ui"
import { Button } from "~/components/ui/button"
import { requireAdmin } from "~/lib/admin.server"
import { listFeatures } from "~/lib/features.server"
import { usageOf } from "~/lib/limits.server"
import { getUserDetail } from "~/services/admin-users.server"
import type { Route } from "./+types/admin.user"
import type { AdminOutletContext } from "./admin-layout"
import type { action as featureAction } from "./admin.user.features"

export async function loader({ context, request, params }: Route.LoaderArgs) {
	const ctx = await requireAdmin(context, request)
	// Better Auth IDs: checked for shape only after the caller is known to be an admin.
	if (!/^[\w-]{1,80}$/.test(params.id)) throw data({ error: "invalid" }, { status: 400 })
	const account = await getUserDetail(ctx, params.id)
	if (!account) throw data({ error: "not_found" }, { status: 404 })
	const [on, usage] = await Promise.all([listFeatures(account.id), usageOf(account.id)])
	// Every known flag, on or off: the page lists them all.
	const features = featureFlags.map((name) => ({ name, on: on.includes(name) }))
	const mb = (bytes: number) => Math.round(bytes / (1024 * 1024))
	return {
		account,
		features,
		usage: {
			saves: usage.saves,
			storage: { used: mb(usage.storage.used), max: mb(usage.storage.max) },
			feeds: usage.feeds,
			editions: usage.editions,
			ai: usage.ai,
			refused: usage.refused,
		},
	}
}

export default function AdminUser({
	loaderData: { account, features, usage },
}: Route.ComponentProps) {
	const { t } = useTranslation("admin")
	const time = useUtcTime()
	const rows: Array<[string, React.ReactNode]> = [
		[t("common.id"), <Mono key="id">{account.id}</Mono>],
		[t("users.name"), account.name],
		[t("users.email"), account.email],
		[t("users.role"), t(`users.roles.${account.role}`)],
		[t("users.verified"), account.emailVerified ? t("common.yes") : t("common.no")],
		[t("users.signedUp"), time(account.createdAt)],
		[
			t("users.invitedBy"),
			account.invitedBy ? (
				<Link
					key="inviter"
					to={`/admin/users/${account.invitedBy.id}`}
					prefetch="none"
					className="text-link"
				>
					{account.invitedBy.name}
				</Link>
			) : (
				t("common.none")
			),
		],
		[t("users.articles"), account.articles],
		[t("users.highlights"), account.highlights],
		[t("users.activeSessions"), account.activeSessions],
		[t("usage.orders.saves"), `${usage.saves.used} / ${usage.saves.max}`],
		[t("usage.storage"), `${usage.storage.used} MB / ${usage.storage.max} MB`],
		[t("usage.orders.feeds"), `${usage.feeds.used} / ${usage.feeds.max}`],
		[t("usage.editionsThisMonth"), `${usage.editions.used} / ${usage.editions.max}`],
		[t("usage.aiThisMonth"), `${usage.ai.used} / ${usage.ai.max}`],
		[t("usage.orders.refused"), usage.refused],
	]
	return (
		<>
			<PageHeader title={t("users.details")}>
				<Link to="/admin/users" prefetch="none" className="text-sm text-link hover:underline">
					{t("users.back")}
				</Link>
			</PageHeader>
			<Card title={account.name || account.id}>
				<dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[14rem_1fr]">
					{rows.map(([label, value]) => (
						<div key={label} className="contents">
							<dt className="text-muted-fg">{label}</dt>
							<dd>{value}</dd>
						</div>
					))}
				</dl>
			</Card>
			<div className="mt-4">
				<Card title={t("users.features.title")}>
					{features.length ? (
						<ul className="divide-y divide-border">
							{features.map((feature) => (
								<FeatureRow key={feature.name} userId={account.id} feature={feature} />
							))}
						</ul>
					) : (
						<p className="text-sm text-muted-fg">{t("users.features.none")}</p>
					)}
				</Card>
			</div>
			<p className="mt-4 text-sm text-muted-fg">{t("users.readOnly")}</p>
		</>
	)
}

function FeatureRow({
	userId,
	feature,
}: {
	userId: string
	feature: Route.ComponentProps["loaderData"]["features"][number]
}) {
	const { t } = useTranslation("admin")
	const { canWrite } = useOutletContext<AdminOutletContext>()
	const fetcher = useFetcher<typeof featureAction>()
	// The change on its way shows at once; the reloaded page confirms it.
	const pending = fetcher.formData?.get("enabled")
	const on = pending ? pending === "on" : feature.on
	return (
		<li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
			<div className="min-w-0 flex-1">
				<p className="flex items-center gap-2 text-sm font-medium">
					{t(`users.features.flags.${feature.name}.name`, { defaultValue: feature.name })}
					<Badge tone={on ? "good" : "neutral"}>
						{on ? t("users.features.on") : t("users.features.off")}
					</Badge>
				</p>
				<p className="mt-1 text-sm text-muted-fg">
					{t(`users.features.flags.${feature.name}.description`, { defaultValue: "" })}
				</p>
			</div>
			{canWrite ? (
				<fetcher.Form method="post" action={`/admin/users/${userId}/features`}>
					<input type="hidden" name="feature" value={feature.name} />
					<input type="hidden" name="enabled" value={on ? "off" : "on"} />
					<Button type="submit" variant="secondary" size="sm" disabled={fetcher.state !== "idle"}>
						{on ? t("users.features.turnOff") : t("users.features.turnOn")}
					</Button>
				</fetcher.Form>
			) : null}
			{fetcher.data && !fetcher.data.ok ? <ActionError code={fetcher.data.error.code} /> : null}
		</li>
	)
}
