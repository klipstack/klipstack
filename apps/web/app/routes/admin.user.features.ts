import { isFeatureFlag } from "@klipstack/db"
import { data } from "react-router"
import { adminErrorResponse, adminRefusal, requireAdminAction } from "~/lib/admin.server"
import { setFeature } from "~/services/admin-features.server"
import type { Route } from "./+types/admin.user.features"

/** POST /admin/users/:id/features: `feature`, one of the known flags, and `enabled`, "on" or "off". */
export async function action({ request, context, params }: Route.ActionArgs) {
	const { ctx, form } = await requireAdminAction(context, request)
	const feature = form.get("feature")
	const enabled = form.get("enabled")
	if (
		!/^[\w-]{1,80}$/.test(params.id) ||
		!isFeatureFlag(feature) ||
		(enabled !== "on" && enabled !== "off")
	)
		return adminRefusal("invalid_request", "That request was not valid.")
	try {
		const result = await setFeature(ctx, params.id, feature, enabled === "on")
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
