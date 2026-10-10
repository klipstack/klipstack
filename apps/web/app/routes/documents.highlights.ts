import { data } from "react-router"
import {
	createHighlight,
	deleteHighlight,
	resizeHighlight,
	restoreHighlight,
	updateHighlight,
} from "~/commands/annotations.server"
import { AppError } from "~/lib/app-error"
import { answerNetworkFailure, NETWORK_FAILURE } from "~/lib/network-failure"
import { readForm, readJson } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { answer, refused } from "~/lib/web-action.server"
import type { Route } from "./+types/documents.highlights"

type Body = Record<string, unknown>

async function readBody(request: Request): Promise<Body> {
	const type = request.headers.get("content-type") ?? ""
	const body = type.includes("application/json")
		? await readJson(request)
		: Object.fromEntries((await readForm(request)).entries())
	return body && typeof body === "object" ? (body as Body) : {}
}

/** A form's numbers come as text; JSON's as numbers. */
const number = (value: unknown) =>
	value === undefined || value === null || value === "" ? undefined : Number(value)

/**
 * POST /documents/:id/highlights  (JSON or form, `intent`: create | update | delete | restore |
 * resize). The same commands as the API and MCP; answers `{ok: true, highlight}` (or
 * `{ok: true, id}`), or the command's refusal.
 */
export async function clientAction({ serverAction, request }: Route.ClientActionArgs) {
	const body = await request
		.clone()
		.json()
		.catch(() => null)
	try {
		return await answerNetworkFailure(serverAction)
	} catch (error) {
		// A resize reconciles any failure with the highlight as stored.
		if (body?.intent === "resize") return NETWORK_FAILURE
		throw error
	}
}

export async function action({ request, context, params }: Route.ActionArgs) {
	const user = requireUser(context, request)
	let body: Body
	try {
		body = await readBody(request)
	} catch (error) {
		if (error instanceof Response) throw error
		return refused(new AppError("invalid_request", "The body is not valid JSON."))
	}
	const id = String(body.id ?? "")
	return answer(
		async () => {
			switch (body.intent) {
				case "create":
					return {
						highlight: await createHighlight(user.id, params.id, {
							exact: String(body.exact ?? ""),
							prefix: body.prefix as string | undefined,
							suffix: body.suffix as string | undefined,
							start: number(body.start),
							end: number(body.end),
							color: number(body.color),
							note: body.note as string | null | undefined,
						}),
					}
				case "update":
					return {
						highlight: await updateHighlight(user.id, id, {
							...("note" in body ? { note: body.note as string | null } : {}),
							...("color" in body ? { color: number(body.color) } : {}),
						}),
					}
				case "delete":
					await deleteHighlight(user.id, id)
					return { id }
				case "restore":
					await restoreHighlight(user.id, id)
					return { id }
				case "resize":
					return {
						highlight: await resizeHighlight(user.id, params.id, {
							id,
							versionId: body.versionId as string,
							previous: body.previous as never,
							selector: body.selector as never,
						}),
					}
				default:
					throw new AppError("invalid_request", "Unknown intent.")
			}
		},
		body.intent === "create" ? 201 : undefined,
	)
}

export async function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
