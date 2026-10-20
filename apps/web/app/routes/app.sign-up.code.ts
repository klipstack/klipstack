import { errorResponse } from "~/api/errors.server"
import { AppError } from "~/lib/app-error"
import { sendAppSignUpCode } from "~/lib/app-sign-up.server"
import { readSmallJson } from "~/lib/request-body.server"
import type { Route } from "./+types/app.sign-up.code"

/** `POST /app/sign-up/code`: emails a sign-up code, once the invite checks out. 204. */
export async function action({ request }: Route.ActionArgs) {
	if (request.method !== "POST") return new Response(null, { status: 405 })
	try {
		await sendAppSignUpCode(await readSmallJson(request), request.headers)
		return new Response(null, { status: 204 })
	} catch (error) {
		if (error instanceof AppError) return errorResponse(error)
		throw error
	}
}
