import { useTranslation } from "react-i18next"
import { Form, Link, useNavigation, useSubmit } from "react-router"
import { Badge, Empty, PageHeader, RefreshButton, Table } from "~/components/admin/ui"
import { Button } from "~/components/ui/button"
import { Label } from "~/components/ui/label"
import { isUsageOrder, USAGE_ORDERS, USAGE_TOP, type UsageOrder } from "~/lib/admin-constants"
import { requireAdmin } from "~/lib/admin.server"
import { getLocale } from "~/lib/i18n.server"
import { cn } from "~/lib/utils"
import { listTopicUsage, listUsage } from "~/services/admin-usage.server"
import type { Route } from "./+types/admin.usage"

const MB = 1024 * 1024

export async function loader({ context, request }: Route.LoaderArgs) {
	const ctx = await requireAdmin(context, request)
	const raw = new URL(request.url).searchParams.get("by")
	const by: UsageOrder = isUsageOrder(raw) ? raw : "refused"
	const [{ rows, limits, month, aiCostUsd, topicCostUsd }, topicUsage] = await Promise.all([
		listUsage(ctx, by),
		listTopicUsage(ctx),
	])
	// Money is formatted here, as numbers are in Settings: the server's Intl and the browser's may
	// differ. Cents an account spends show as less than one cent, not as nothing.
	const usd = new Intl.NumberFormat(getLocale(context), { style: "currency", currency: "USD" })
	const dollars = (amount: number) =>
		amount > 0 && amount < 0.01 ? { under: usd.format(0.01) } : { amount: usd.format(amount) }
	return {
		by,
		// Whole numbers only, so the server and the browser show them alike.
		rows: rows.map(({ storageBytes, aiCostUsd, topicCostUsd, ...row }) => ({
			...row,
			storageMb: Math.round(storageBytes / MB),
			aiCost: dollars(aiCostUsd),
			topicCost: dollars(topicCostUsd),
		})),
		limits: { ...limits, storage: Math.round(limits.storage / MB) },
		month: month.slice(0, 7),
		aiCostTotal: dollars(aiCostUsd),
		topicCostTotal: dollars(topicCostUsd),
		topics: {
			rows: topicUsage.rows.map(({ costUsd, ...row }) => ({ ...row, cost: dollars(costUsd) })),
			limits: topicUsage.limits,
		},
	}
}

type Dollars = { under: string } | { amount: string }

/** An amount in dollars, or "< $0.01" for cents an account spends. */
function Cost({ value }: { value: Dollars }) {
	const { t } = useTranslation("admin")
	return "under" in value ? t("usage.aiCostUnder", { amount: value.under }) : value.amount
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

export default function AdminUsage({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("admin")
	const dollarsText = (value: Dollars) =>
		"under" in value ? t("usage.aiCostUnder", { amount: value.under }) : value.amount
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
						t("usage.topicCost"),
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
							<td className="tabular-nums">
								<Cost value={row.aiCost} />
							</td>
							<td className="tabular-nums">
								<Cost value={row.topicCost} />
							</td>
						</tr>
					))}
				</Table>
			) : (
				<Empty>{t("usage.empty")}</Empty>
			)}
			<p className="mt-4 text-sm text-muted-fg">{t("usage.month", { month: loaderData.month })}</p>
			<p className="mt-4 text-sm font-medium" data-testid="ai-cost-total">
				{t("usage.aiCostTotal", { amount: dollarsText(loaderData.aiCostTotal) })}
			</p>
			<p className="mt-1 text-sm text-muted-fg">{t("usage.aiCostNote")}</p>
			<p className="mt-4 text-sm font-medium" data-testid="topic-cost-total">
				{t("usage.topicCostTotal", { amount: dollarsText(loaderData.topicCostTotal) })}
			</p>
			<p className="mt-1 text-sm text-muted-fg">{t("usage.topicCostNote")}</p>
			<TopicUsage topics={loaderData.topics} />
		</>
	)
}

/** The accounts that used topics this month: what they cost, against the caps. */
function TopicUsage({ topics }: { topics: Route.ComponentProps["loaderData"]["topics"] }) {
	const { t } = useTranslation("admin")
	return (
		<section className="mt-8" aria-labelledby="topic-usage">
			<h2 id="topic-usage" className="mb-2 text-lg font-semibold">
				{t("usage.topics.title")}
			</h2>
			<p className="mb-4 text-sm text-muted-fg">
				{t("usage.topics.description", { count: USAGE_TOP })}
			</p>
			{topics.rows.length ? (
				<Table
					caption={t("usage.topics.title")}
					head={[
						t("users.name"),
						t("usage.topics.cost"),
						t("usage.topics.sorts"),
						t("usage.topics.work"),
					]}
				>
					{topics.rows.map((row) => (
						<tr key={row.id}>
							<td>
								<Link to={`/admin/users/${row.id}`} prefetch="none" className="text-link">
									{row.name || row.id}
								</Link>
								<div className="text-xs text-muted-fg">{row.email}</div>
							</td>
							<td className="tabular-nums">
								<Cost value={row.cost} />
							</td>
							<td>
								<Against used={row.sorts} max={topics.limits.sorts} />
							</td>
							<td>
								<Against used={row.work} max={topics.limits.topics} />
							</td>
						</tr>
					))}
				</Table>
			) : (
				<Empty>{t("usage.topics.empty")}</Empty>
			)}
		</section>
	)
}
