import { Id } from "@klipstack/api-contract"
import { fallbackLanguage, isLocale } from "@klipstack/i18n/languages"
import { z } from "zod"
import { shareHighlight, stopSharingHighlight } from "~/commands/highlight-shares.server"
import { parseInput } from "~/lib/app-error"
import { getLocale } from "~/lib/i18n.server"
import { readFields } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { answer } from "~/lib/web-action.server"
import { getShareState } from "~/services/highlight-shares.server"
import type { Route } from "./+types/highlights.share"

/** GET /highlights/:id/share — the highlight's share for the Share dialog: live, removed or none. */
export async function loader({ request, context, params }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	return answer(async () => ({
		share: await getShareState(user.id, parseInput(Id, params.id)),
	}))
}

const Change = z.discriminatedUnion("intent", [
	z.object({ intent: z.literal("share"), includeNote: z.boolean() }),
	z.object({ intent: z.literal("stop") }),
])

/**
 * POST /highlights/:id/share — JSON `{intent: "share", includeNote}` shares the highlight, or
 * updates its page when it is shared already; `{intent: "stop"}` takes the page down. The page
 * speaks the language the reader uses the app in.
 */
export async function action({ request, context, params }: Route.ActionArgs) {
	const user = requireUser(context, request)
	return answer(async () => {
		const change = parseInput(Change, await readFields(request))
		if (change.intent === "stop") {
			await stopSharingHighlight(user.id, params.id)
			return { share: null }
		}
		const ui = getLocale(context)
		const locale = isLocale(ui) ? ui : fallbackLanguage
		return {
			share: await shareHighlight(user.id, params.id, { includeNote: change.includeNote, locale }),
		}
	})
}
