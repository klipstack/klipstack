import { data } from "react-router"
import {
	createSavedSearch,
	deleteSavedSearch,
	dropTopicFromSavedSearch,
	renameSavedSearch,
} from "~/commands/saved-searches.server"
import { AppError } from "~/lib/app-error"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { answer } from "~/lib/web-action.server"
import type { Route } from "./+types/saved-searches"

/**
 * POST /saved-searches  intent=create|rename|delete|drop-topic (`topic`, one that ended). The
 * search page and the sidebar post here, through the same commands as the API. The sidebar reads
 * its rows from the layout loader, which runs again after this.
 */
export async function action({ request, context }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const form = await readForm(request)
	const field = (name: string) => String(form.get(name) ?? "")
	return answer(async () => {
		switch (form.get("intent")) {
			case "create":
				return {
					saved: await createSavedSearch(user.id, { name: field("name"), query: field("query") }),
				}
			case "rename":
				return { saved: await renameSavedSearch(user.id, field("id"), field("name")) }
			case "drop-topic":
				return { saved: await dropTopicFromSavedSearch(user.id, field("id"), field("topic")) }
			case "delete":
				await deleteSavedSearch(user.id, field("id"))
				return { deleted: field("id") }
			default:
				throw new AppError("invalid_request", "Unknown intent.")
		}
	})
}

export async function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
