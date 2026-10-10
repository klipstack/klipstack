import { data } from "react-router"
import { z } from "zod"
import { adminErrorResponse, adminRefusal, requireAdminAction } from "~/lib/admin.server"
import { isReportReason, REMOVAL_NOTE_MAX } from "~/lib/edition-reports"
import { removeEdition } from "~/services/admin-reports.server"
import type { Route } from "./+types/admin.reports.remove"

/**
 * POST /admin/reports/:id/remove: takes the edition down, with a ground and a note the owner gets
 * by email. Its reports close; reporters who left an address are told.
 */
export async function action({ request, context, params }: Route.ActionArgs) {
	const { ctx, form } = await requireAdminAction(context, request)
	const id = z.uuid().safeParse(params.id)
	const ground = form.get("ground")
	const note = form.get("note")
	if (
		!id.success ||
		!isReportReason(ground) ||
		typeof note !== "string" ||
		!note.trim() ||
		note.length > REMOVAL_NOTE_MAX
	)
		return adminRefusal("invalid_request", "Choose a ground and write why.")
	try {
		return { ok: true as const, ...(await removeEdition(ctx, id.data, { ground, note })) }
	} catch (error) {
		const response = adminErrorResponse(error)
		if (response) return response
		throw error
	}
}

export function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
