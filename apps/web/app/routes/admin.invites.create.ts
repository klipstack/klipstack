import { data } from "react-router"
import { z } from "zod"
import { INVITE_EXPIRIES, INVITE_NOTE_MAX } from "~/lib/admin-constants"
import { adminErrorResponse, adminRefusal, requireAdminAction } from "~/lib/admin.server"
import { createAdminInvite } from "~/services/admin-invites.server"
import type { Route } from "./+types/admin.invites.create"

const schema = z.object({
	note: z.string().trim().max(INVITE_NOTE_MAX).optional(),
	expiry: z.enum(INVITE_EXPIRIES).default("7d"),
})

/** POST /admin/invites/create: an optional note and an expiry choice. The creator is the session's. */
export async function action({ request, context }: Route.ActionArgs) {
	const { ctx, form } = await requireAdminAction(context, request)
	const parsed = schema.safeParse({
		note: form.get("note") ?? undefined,
		expiry: form.get("expiry") ?? undefined,
	})
	if (!parsed.success) return adminRefusal("invalid_request", "That request was not valid.")
	try {
		const invite = await createAdminInvite(ctx, parsed.data)
		return data({ ok: true as const, id: invite.id, code: invite.code }, { status: 201 })
	} catch (error) {
		const response = adminErrorResponse(error)
		if (response) return response
		throw error
	}
}

export function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
