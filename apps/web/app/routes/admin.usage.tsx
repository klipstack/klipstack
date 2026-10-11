import { useTranslation } from "react-i18next"
import { Form, Link, useNavigation, useSubmit } from "react-router"
import { Badge, Empty, PageHeader, RefreshButton, Table } from "~/components/admin/ui"
import { Button } from "~/components/ui/button"
import { Label } from "~/components/ui/label"
import { isUsageOrder, USAGE_ORDERS, USAGE_TOP, type UsageOrder } from "~/lib/admin-constants"
import { requireAdmin } from "~/lib/admin.server"
import { cn } from "~/lib/utils"
import { listUsage } from "~/services/admin-usage.server"
import type { Route } from "./+types/admin.usage"

const MB = 1024 * 1024

export async function loader({ context, request }: Route.LoaderArgs) {
	const ctx = await requireAdmin(context, request)
	const raw = new URL(request.url).searchParams.get("by")
	const by: UsageOrder = isUsageOrder(raw) ? raw : "refused"
	const { rows, limits, month } = await listUsage(ctx, by)
	return {
		by,
		// Whole numbers only, so the server and the browser show them alike.
		rows: rows.map(({ storageBytes, ...row }) => ({
			...row,
			storageMb: Math.round(storageBytes / MB),
		})),
		limits: { ...limits, storage: Math.round(limits.storage / MB) },
		month: month.slice(0, 7),
	}
}

/** `used / max`, red at the cap and bold from 80 %. */
function Against({ used, max, unit = "" }: { used: number; max: number; unit?: string }) {
	return (
		<span
			className={cn(
				"tabular-nums",
				used >= max ? "font-medium text-danger" : used >= max * 0.8 && "font-medium",
			)}
		>
			{used}
			{unit} / {max}
			{unit}
		</span>
	)
}

/** Dollars to the cent, and the cents an account spends as "< $0.01" rather than nothing. */
function dollars(usd: number) {
	if (usd > 0 && usd < 0.01) return "< $0.01"
	return `$${usd.toFixed(2)}`
}

export default function AdminUsage({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("admin")
	const submit = useSubmit()
	// As on the invites page: the choice on its way, then the one the URL holds.
	const next = useNavigation().location
	const pending =
		next?.pathname === "/admin/usage" ? new URLSearchParams(next.search).get("by") : null
	const { limits } = loaderData
	return (
		<>
			<PageHeader title={t("usage.title")}>
				<RefreshButton />
			</PageHeader>
			<p className="mb-4 text-sm text-muted-fg">{t("usage.description", { count: USAGE_TOP })}</p>
			<Form method="get" className="mb-4 flex items-end gap-2">
				<div>
					<Label htmlFor="usage-order">{t("usage.order")}</Label>
					<select
						id="usage-order"
						name="by"
						value={pending ?? loaderData.by}
						onChange={(event) => submit(event.currentTarget.form)}
						className="block h-10 rounded-lg border border-border bg-bg px-3 text-sm"
					>
						{USAGE_ORDERS.map((order) => (
							<option key={order} value={order}>
								{t(`usage.orders.${order}`)}
							</option>
						))}
					</select>
				</div>
				<noscript>
					<Button type="submit" variant="secondary">
						{t("usage.order")}
					</Button>
				</noscript>
			</Form>
			{loaderData.rows.length ? (
				<Table
					caption={t("usage.title")}
					head={[
						t("users.name"),
						t("usage.refused"),
						t("usage.storage"),
						t("usage.saves"),
						t("usage.feeds"),
						t("usage.editions"),
						t("usage.ai"),
						t("usage.aiCost"),
					]}
				>
					{loaderData.rows.map((row) => (
						<tr key={row.id}>
							<td>
								<Link to={`/admin/users/${row.id}`} prefetch="none" className="text-link">
									{row.name || row.id}
								</Link>
								<div className="text-xs text-muted-fg">{row.email}</div>
							</td>
							<td>
								{row.refused > 0 ? (
									<Badge tone="bad">{row.refused}</Badge>
								) : (
									<span className="text-muted-fg">0</span>
								)}
							</td>
							<td>
								<Against used={row.storageMb} max={limits.storage} unit=" MB" />
							</td>
							<td>
								<Against used={row.saves} max={limits.saves} />
							</td>
							<td>
								<Against used={row.feeds} max={limits.feeds} />
							</td>
							<td>
								<Against used={row.editions} max={limits.editions} />
							</td>
							<td>
								<Against used={row.ai} max={row.aiMax} />
							</td>
							<td className="tabular-nums">{dollars(row.aiCostUsd)}</td>
						</tr>
					))}
				</Table>
			) : (
				<Empty>{t("usage.empty")}</Empty>
			)}
			<p className="mt-4 text-sm text-muted-fg">{t("usage.month", { month: loaderData.month })}</p>
			<p className="mt-1 text-sm text-muted-fg">{t("usage.aiCostNote")}</p>
		</>
	)
}
