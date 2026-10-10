import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import {
	Badge,
	Empty,
	Mono,
	PageHeader,
	Pager,
	RefreshButton,
	Table,
	useUtcTime,
} from "~/components/admin/ui"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { USER_SEARCH_MAX } from "~/lib/admin-constants"
import { requireAdmin } from "~/lib/admin.server"
import { listUsers } from "~/services/admin-users.server"
import type { Route } from "./+types/admin.users"

export async function loader({ context, request }: Route.LoaderArgs) {
	const ctx = await requireAdmin(context, request)
	const url = new URL(request.url)
	const query = (url.searchParams.get("q") ?? "").trim().slice(0, USER_SEARCH_MAX)
	return { query, ...(await listUsers(ctx, { query, cursor: url.searchParams.get("cursor") })) }
}

export default function AdminUsers({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("admin")
	const time = useUtcTime()
	return (
		<>
			<PageHeader title={t("users.title")}>
				<RefreshButton />
			</PageHeader>
			<p className="mb-4 text-sm text-muted-fg">{t("users.readOnly")}</p>
			<Form method="get" className="mb-4 flex flex-wrap items-end gap-2" role="search">
				<div className="min-w-56 flex-1">
					<Label htmlFor="user-search">{t("users.search")}</Label>
					<Input
						id="user-search"
						name="q"
						type="search"
						maxLength={USER_SEARCH_MAX}
						defaultValue={loaderData.query}
					/>
				</div>
				<Button type="submit" variant="secondary">
					{t("users.searchSubmit")}
				</Button>
			</Form>
			{loaderData.users.length ? (
				<Table
					caption={t("users.title")}
					head={[
						t("users.name"),
						t("users.email"),
						t("users.role"),
						t("users.verified"),
						t("users.signedUp"),
						t("common.id"),
					]}
				>
					{loaderData.users.map((user) => (
						<tr key={user.id}>
							<td>
								<Link to={`/admin/users/${user.id}`} prefetch="none" className="text-link">
									{user.name || user.id}
								</Link>
							</td>
							<td>{user.email}</td>
							<td>
								<Badge tone={user.role === "admin" ? "warn" : "neutral"}>
									{t(`users.roles.${user.role}`)}
								</Badge>
							</td>
							<td>{user.emailVerified ? t("common.yes") : t("common.no")}</td>
							<td>{time(user.createdAt)}</td>
							<td>
								<Mono>{user.id}</Mono>
							</td>
						</tr>
					))}
				</Table>
			) : (
				<Empty>{t("users.empty")}</Empty>
			)}
			<Pager
				path="/admin/users"
				nextCursor={loaderData.nextCursor}
				params={{ q: loaderData.query }}
			/>
		</>
	)
}
