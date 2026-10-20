import { errorResponse } from "~/api/errors.server"
import { AppError } from "~/lib/app-error"
import { sendAppSignInCode } from "~/lib/app-sign-in.server"
import type { Route } from "./+types/app.sign-in.code"
import { jsonBody } from "./app.sign-in"

/** `POST /app/sign-in/code`: emails a sign-in code to an existing account. 204 either way. */
export async function action({ request }: Route.ActionArgs) {
	if (request.method !== "POST") return new Response(null, { status: 405 })
	try {
		await sendAppSignInCode(await jsonBody(request), request.headers)
		return new Response(null, { status: 204 })
	} catch (error) {
		if (error instanceof AppError) return errorResponse(error)
		throw error
	}
}
