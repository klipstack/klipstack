import { data } from "react-router"
import { z } from "zod"
import { adminErrorResponse, adminRefusal, requireAdminAction } from "~/lib/admin.server"
import { dismissReports, dismissShareReports } from "~/services/admin-reports.server"
import type { Route } from "./+types/admin.reports.dismiss"

/**
 * POST /admin/reports/:id/dismiss: closes the edition's reports (or the shared highlight's, with
 * `kind=share`) and leaves it up.
 */
export async function action({ request, context, params }: Route.ActionArgs) {
	const { ctx, form } = await requireAdminAction(context, request)
	const id = z.uuid().safeParse(params.id)
	if (!id.success) return adminRefusal("invalid_request", "That edition was not valid.")
	try {
		const dismiss = form.get("kind") === "share" ? dismissShareReports : dismissReports
		return { ok: true as const, ...(await dismiss(ctx, id.data)) }
	} catch (error) {
		const response = adminErrorResponse(error)
		if (response) return response
		throw error
	}
}

export function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
