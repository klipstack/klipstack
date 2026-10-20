import { errorResponse } from "~/api/errors.server"
import { AppError } from "~/lib/app-error"
import { appSignUp } from "~/lib/app-sign-up.server"
import { readSmallJson } from "~/lib/request-body.server"
import type { Route } from "./+types/app.sign-up"

/** `POST /app/sign-up`: creates the account in the iPhone app; the authorization code (`appSignUp`). */
export async function action({ request }: Route.ActionArgs) {
	if (request.method !== "POST") return new Response(null, { status: 405 })
	try {
		const code = await appSignUp(await readSmallJson(request), request.headers)
		return Response.json(code, { headers: { "cache-control": "no-store" } })
	} catch (error) {
		if (error instanceof AppError) return errorResponse(error)
		throw error
	}
}
