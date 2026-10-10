import { data } from "react-router"
import { z } from "zod"
import { adminErrorResponse, adminRefusal, requireAdminAction } from "~/lib/admin.server"
import { restoreEdition } from "~/services/admin-reports.server"
import type { Route } from "./+types/admin.reports.restore"

/** POST /admin/reports/:id/restore: undoes a removal; the owner may publish the edition again. */
export async function action({ request, context, params }: Route.ActionArgs) {
	const { ctx } = await requireAdminAction(context, request)
	const id = z.uuid().safeParse(params.id)
	if (!id.success) return adminRefusal("invalid_request", "That edition was not valid.")
	try {
		return { ok: true as const, ...(await restoreEdition(ctx, id.data)) }
	} catch (error) {
		const response = adminErrorResponse(error)
		if (response) return response
		throw error
	}
}

export function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
