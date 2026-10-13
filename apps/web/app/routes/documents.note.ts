import { data } from "react-router"
import { setArticleNote } from "~/commands/annotations.server"
import { AppError } from "~/lib/app-error"
import { readForm, readJson } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { answer, refused } from "~/lib/web-action.server"
import type { Route } from "./+types/documents.note"

async function readBody(request: Request): Promise<Record<string, unknown>> {
	const type = request.headers.get("content-type") ?? ""
	const body = type.includes("application/json")
		? await readJson(request)
		: Object.fromEntries((await readForm(request)).entries())
	return body && typeof body === "object" ? (body as Record<string, unknown>) : {}
}

/**
 * POST /documents/:id/note — JSON or form body `{ note, expectedUpdatedAt? }`. Blank or null
 * clears the note. The reader's autosave sends no `expectedUpdatedAt`: the last save wins, as typing
 * in one place expects. The Notebook sends it, and gets `note_changed` (409) with the current note
 * when the note was saved elsewhere meanwhile.
 */
export async function action({ request, context, params }: Route.ActionArgs) {
	const user = requireUser(context, request)
	let body: Record<string, unknown>
	try {
		body = await readBody(request)
	} catch (error) {
		if (error instanceof Response) throw error
		return refused(new AppError("invalid_request", "The body is not valid JSON."))
	}
	return answer(() =>
		setArticleNote(user.id, params.id, {
			note: body.note as string | null,
			expectedUpdatedAt: body.expectedUpdatedAt as string | null | undefined,
		}),
	)
}

export async function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
