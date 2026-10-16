import { data } from "react-router"
import {
	type Asked,
	askAboutPassage,
	askArticle,
	briefArticle,
	deleteThread,
	followUp,
	restoreThread,
	retryAnswer,
} from "~/commands/ai.server"
import { answerEvents, briefEvents, eventStream } from "~/lib/ai-events.server"
import { briefView } from "~/lib/ai-threads"
import { AppError } from "~/lib/app-error"
import { getLocale } from "~/lib/i18n.server"
import { readFields } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { answer, refused } from "~/lib/web-action.server"
import type { Route } from "./+types/documents.ai"

type Body = Record<string, unknown>

/**
 * POST /documents/:id/ai  (JSON, or a form for restore; `intent`: ask | follow-up | retry | delete |
 * restore | brief | chat).
 *
 * ask, chat, follow-up and retry answer with a stream of server-sent events (`AiStreamEvent`): the
 * thread, the question and where the account stands against its cap, the answer's text and citations as they are written, then the answer
 * as saved (its `status` says whether it failed). A refusal before anything is sent (the flag, the
 * cap, the rate limit, a passage not found) is the usual `{ok: false, error}`. delete and restore
 * answer `{ok: true, id}`. brief answers `{ok: true, brief}` when one is kept for the version, else a
 * stream of `AiBriefEvent`s.
 */
export async function action({ request, context, params }: Route.ActionArgs) {
	const user = requireUser(context, request)
	let body: Body
	try {
		// JSON from the reader; a form from the undo toast.
		body = await readFields(request)
	} catch (error) {
		if (error instanceof AppError) return refused(error)
		throw error
	}
	const id = String(body.id ?? "")
	const options = {
		language: getLocale(context) === "es" ? ("es" as const) : ("en" as const),
		signal: request.signal,
	}
	const stream = async (ask: () => Promise<Asked>) => {
		try {
			return eventStream(answerEvents(await ask()), { status: 201 })
		} catch (error) {
			if (error instanceof AppError) return refused(error)
			throw error
		}
	}
	switch (body.intent) {
		case "brief":
			try {
				const brief = await briefArticle(user.id, params.id, options)
				// One kept for this version: no stream, no cost.
				return "events" in brief
					? eventStream(briefEvents(brief), { status: 201 })
					: data({ ok: true as const, brief: briefView(brief) })
			} catch (error) {
				if (error instanceof AppError) return refused(error)
				throw error
			}
		case "ask":
			return stream(() =>
				askAboutPassage(
					user.id,
					params.id,
					{
						action: body.action as never,
						exact: String(body.exact ?? ""),
						prefix: body.prefix as string | undefined,
						suffix: body.suffix as string | undefined,
						start: body.start as number | undefined,
						end: body.end as number | undefined,
						question: body.question as string | undefined,
						highlightId: body.highlightId as string | undefined,
					},
					options,
				),
			)
		case "chat":
			return stream(() => askArticle(user.id, params.id, String(body.question ?? ""), options))
		case "follow-up":
			return stream(() => followUp(user.id, id, String(body.question ?? ""), options))
		case "retry":
			return stream(() => retryAnswer(user.id, id, options))
		case "delete":
			return answer(async () => {
				await deleteThread(user.id, id)
				return { id }
			})
		case "restore":
			return answer(async () => {
				await restoreThread(user.id, id)
				return { id }
			})
		default:
			return refused(new AppError("invalid_request", "Unknown intent."))
	}
}

export async function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
