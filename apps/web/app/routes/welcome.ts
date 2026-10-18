import { redirect } from "react-router"
import { closeWelcome } from "~/commands/welcome.server"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { answer } from "~/lib/web-action.server"
import type { Route } from "./+types/welcome"

/**
 * POST /welcome — Home's welcome note is closed. `intent=guide` ("Show me around") opens the guide
 * to Klipstack, added to the library in the reader's language.
 */
export async function action({ context, request }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const guide = (await readForm(request)).get("intent") === "guide"
	const result = await answer(() => closeWelcome(user.id, { guide, locale: user.locale }))
	if ("ok" in result && result.articleId) throw redirect(`/read/${result.articleId}`)
	return result
}
