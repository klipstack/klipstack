import { data } from "react-router"
import { adminErrorResponse, adminRefusal, requireAdminAction } from "~/lib/admin.server"
import { setFreeUntil } from "~/services/admin-billing.server"
import type { Route } from "./+types/admin.user.billing"

/**
 * POST /admin/users/:id/billing: `freeUntil`, a day (YYYY-MM-DD, UTC) the account has the paid
 * plan free until, or empty to take that back.
 */
export async function action({ request, context, params }: Route.ActionArgs) {
	const { ctx, form } = await requireAdminAction(context, request)
	const raw = form.get("freeUntil")
	const day =
		typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00Z`) : null
	if (
		!/^[\w-]{1,80}$/.test(params.id) ||
		(raw !== "" && (!day || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== raw))
	)
		return adminRefusal("invalid_request", "That request was not valid.")
	try {
		const result = await setFreeUntil(ctx, params.id, raw === "" ? null : day)
		return { ok: true as const, changed: result.changed }
	} catch (error) {
		const response = adminErrorResponse(error)
		if (response) return response
		throw error
	}
}

export function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
