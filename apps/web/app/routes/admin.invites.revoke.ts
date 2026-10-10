import { data } from "react-router"
import { z } from "zod"
import { adminErrorResponse, adminRefusal, requireAdminAction } from "~/lib/admin.server"
import { revokeInvite } from "~/services/admin-invites.server"
import type { Route } from "./+types/admin.invites.revoke"

/** POST /admin/invites/:id/revoke: the invite's internal ID, from the route. No code, no owner. */
export async function action({ request, context, params }: Route.ActionArgs) {
	const { ctx } = await requireAdminAction(context, request)
	const id = z.uuid().safeParse(params.id)
	if (!id.success) return adminRefusal("invalid_request", "That request was not valid.")
	try {
		const result = await revokeInvite(ctx, id.data)
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
