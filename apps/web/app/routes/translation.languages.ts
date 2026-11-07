import { setTranslationChoice } from "~/commands/translation.server"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { answer } from "~/lib/web-action.server"
import type { Route } from "./+types/translation.languages"

/**
 * POST /translation/languages (form: `language`, `choice`: never, always or ask). What the account
 * does with articles in a language. Answers both lists.
 */
export async function action({ request, context }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const form = await readForm(request)
	return answer(async () => ({
		languages: await setTranslationChoice(user.id, {
			language: String(form.get("language") ?? ""),
			choice: String(form.get("choice") ?? "") as "never",
		}),
	}))
}
