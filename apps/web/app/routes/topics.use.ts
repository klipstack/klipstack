import { countTopicUse } from "~/commands/topics.server"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { answer } from "~/lib/web-action.server"
import type { Route } from "./+types/topics.use"

/** POST /topics/use  use=<a click `countTopicUse` counts>. The browser's beacon: no page answers. */
export async function action({ request, context }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const use = String((await readForm(request)).get("use") ?? "")
	return answer(async () => {
		await countTopicUse(user.id, use)
		return {}
	})
}
