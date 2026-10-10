import { data } from "react-router"
import { editionAction } from "~/lib/edition-action.server"
import { readFields } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { answer } from "~/lib/web-action.server"
import type { Route } from "./+types/editions.save"

/**
 * POST /editions/:id/save — the editor's autosave: the same changes as the editor's own action,
 * without a page to render, so a save can outlive the page (`keepalive`).
 */
export async function action({ request, context, params }: Route.ActionArgs) {
	const user = requireUser(context, request)
	return answer(async () => editionAction(user.id, params.id, await readFields(request)))
}

export async function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
