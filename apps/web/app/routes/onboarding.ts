import { redirect } from "react-router"
import { closeWelcome, endGettingStarted } from "~/commands/onboarding.server"
import { AppError } from "~/lib/app-error"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { answer } from "~/lib/web-action.server"
import type { Route } from "./+types/onboarding"

/**
 * POST /onboarding — a new account's first steps.
 * - `intent=guide`: Home's welcome note is closed with "Show me around": the guide to Klipstack
 *   opens, added to the library in the reader's language.
 * - `intent=explore`: the welcome note is closed.
 * - `intent=end-card`: the sidebar's Getting started card is closed, or was seen finished.
 */
export async function action({ context, request }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const intent = (await readForm(request)).get("intent")
	const result = await answer(async () => {
		switch (intent) {
			case "guide":
			case "explore":
				return closeWelcome(user.id, { guide: intent === "guide", locale: user.locale })
			case "end-card":
				await endGettingStarted(user.id)
				return { articleId: null }
			default:
				throw new AppError("invalid_request", "Unknown intent.")
		}
	})
	if ("ok" in result && result.articleId) throw redirect(`/read/${result.articleId}`)
	return result
}
