import { data } from "react-router"
import { z } from "zod"
import { adminErrorResponse, adminRefusal, requireAdminAction } from "~/lib/admin.server"
import { restoreEdition, restoreShare } from "~/services/admin-reports.server"
import type { Route } from "./+types/admin.reports.restore"

/**
 * POST /admin/reports/:id/restore: undoes a removal; the owner may publish the edition again (or
 * share the highlight again, with `kind=share`).
 */
export async function action({ request, context, params }: Route.ActionArgs) {
	const { ctx, form } = await requireAdminAction(context, request)
	const id = z.uuid().safeParse(params.id)
	if (!id.success) return adminRefusal("invalid_request", "That edition was not valid.")
	try {
		const restore = form.get("kind") === "share" ? restoreShare : restoreEdition
		return { ok: true as const, ...(await restore(ctx, id.data)) }
	} catch (error) {
		const response = adminErrorResponse(error)
		if (response) return response
		throw error
	}
}

export function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
