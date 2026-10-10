import { data } from "react-router"
import { z } from "zod"
import { adminErrorResponse, adminRefusal, requireAdminAction } from "~/lib/admin.server"
import { dismissInviteRequest } from "~/services/admin-invite-requests.server"
import type { Route } from "./+types/admin.requests.dismiss"

/** POST /admin/requests/:id/dismiss: deletes the request. Nobody is emailed. */
export async function action({ request, context, params }: Route.ActionArgs) {
	const { ctx } = await requireAdminAction(context, request)
	const id = z.uuid().safeParse(params.id)
	if (!id.success) return adminRefusal("invalid_request", "That request was not valid.")
	try {
		return { ok: true as const, ...(await dismissInviteRequest(ctx, id.data)) }
	} catch (error) {
		const response = adminErrorResponse(error)
		if (response) return response
		throw error
	}
}

export function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
