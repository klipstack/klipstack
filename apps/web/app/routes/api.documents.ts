import { errorResponse } from "~/api/errors.server"
import { type SaveRequest, saveArticle } from "~/commands/saving.server"
import { AppError, rateLimited } from "~/lib/app-error"
import { peekRateLimit, SAVE_LIMIT } from "~/lib/rate-limit.server"
import { CAPTURE_BODY, readJson } from "~/lib/request-body.server"
import { getUser } from "~/lib/session.server"
import { articleSummary } from "~/services/article-summary.server"
import type { Route } from "./+types/api.documents"

/**
 * POST /api/documents  { url, html?, source? }
 * Save a page, for the browser session only: the reader's link popover and the extension (which
 * sends the cookies of the browser it runs in). `html` is the rendered DOM the extension captured;
 * without it the worker fetches the URL itself. Answers as `POST /api/v1/articles` does: 202 with
 * `{article, created}` when new, 200 when already saved, and the API's error body. Programs use
 * that endpoint with a token instead.
 */
export async function action({ request, context }: Route.ActionArgs) {
	if (request.method !== "POST")
		return errorResponse(new AppError("method_not_allowed", "This endpoint takes POST."))
	const user = getUser(context)
	if (!user) return errorResponse(new AppError("unauthorized", "Sign in to Klipstack first."))
	// Refused before the body is read: a capture may be megabytes. The save counts it.
	const peek = peekRateLimit(`save:${user.id}`, SAVE_LIMIT.limit, SAVE_LIMIT.windowMs)
	if (!peek.ok) return errorResponse(rateLimited(peek.retryAfterSeconds, "saves"))

	let body: Partial<SaveRequest>
	try {
		const raw = await readJson(request, CAPTURE_BODY, user.id)
		body = raw && typeof raw === "object" ? (raw as Partial<SaveRequest>) : {}
	} catch (error) {
		if (error instanceof Response) throw error
		return errorResponse(new AppError("invalid_request", "The body is not valid JSON."))
	}

	try {
		const { article, created } = await saveArticle(user.id, {
			url: body.url as string,
			html: body.html ?? null,
			source: body.source ?? (body.html ? "extension" : "api"),
		})
		return Response.json(
			{ article: articleSummary(article), created },
			{ status: created ? 202 : 200, headers: { "cache-control": "no-store" } },
		)
	} catch (error) {
		if (error instanceof AppError) return errorResponse(error)
		throw error
	}
}

export async function loader() {
	return errorResponse(new AppError("method_not_allowed", "This endpoint takes POST."))
}
