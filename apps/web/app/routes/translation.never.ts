import { setNeverTranslate } from "~/commands/translation.server"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { answer } from "~/lib/web-action.server"
import type { Route } from "./+types/translation.never"

/**
 * POST /translation/never (form: `language`, `never`: "true" or "false"). The languages the
 * account reads, which articles are not offered a translation in. Answers the list.
 */
export async function action({ request, context }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const form = await readForm(request)
	return answer(async () => ({
		neverTranslate: await setNeverTranslate(user.id, {
			language: String(form.get("language") ?? ""),
			never: form.get("never") !== "false",
		}),
	}))
}
