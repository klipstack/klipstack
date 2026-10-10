import { setPrefs } from "~/commands/account.server"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { answer } from "~/lib/web-action.server"
import type { Route } from "./+types/prefs"

/** POST /prefs — merge reader preferences into the user's prefs. */
export async function action({ request, context }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const fields = Object.fromEntries((await readForm(request)).entries())
	return answer(async () => ({ prefs: await setPrefs(user.id, fields) }))
}
