import { data } from "react-router"
import { z } from "zod"
import { adminErrorResponse, adminRefusal, requireAdminAction } from "~/lib/admin.server"
import { approveInviteRequest } from "~/services/admin-invite-requests.server"
import type { Route } from "./+types/admin.requests.approve"

/** POST /admin/requests/:id/approve: creates an invite for the request and emails its code. */
export async function action({ request, context, params }: Route.ActionArgs) {
	const { ctx } = await requireAdminAction(context, request)
	const id = z.uuid().safeParse(params.id)
	if (!id.success) return adminRefusal("invalid_request", "That request was not valid.")
	try {
		const result = await approveInviteRequest(ctx, id.data)
		return data({ ok: true as const, ...result }, { status: 201 })
	} catch (error) {
		const response = adminErrorResponse(error)
		if (response) return response
		throw error
	}
}

export function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
