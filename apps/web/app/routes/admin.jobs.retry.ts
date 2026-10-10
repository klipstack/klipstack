import { data } from "react-router"
import { z } from "zod"
import { adminErrorResponse, adminRefusal, requireAdminAction } from "~/lib/admin.server"
import { retryJob } from "~/services/admin-jobs.server"
import type { Route } from "./+types/admin.jobs.retry"

const schema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("extract"), documentId: z.uuid() }),
	z.object({ kind: z.literal("images"), jobId: z.uuid() }),
])

/**
 * POST /admin/jobs/retry: `kind=extract` with a document ID, or `kind=images` with a failed job's
 * ID. 202 means the work was queued, not that it finished.
 */
export async function action({ request, context }: Route.ActionArgs) {
	const { ctx, form } = await requireAdminAction(context, request)
	const parsed = schema.safeParse({
		kind: form.get("kind"),
		documentId: form.get("documentId") ?? undefined,
		jobId: form.get("jobId") ?? undefined,
	})
	if (!parsed.success) return adminRefusal("invalid_request", "That request was not valid.")
	try {
		await retryJob(ctx, parsed.data)
		return data({ ok: true as const, admitted: true }, { status: 202 })
	} catch (error) {
		const response = adminErrorResponse(error)
		if (response) return response
		throw error
	}
}

export function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
