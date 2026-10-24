import { errorResponse } from "~/api/errors.server"
import { AppError } from "~/lib/app-error"
import { appSignInTwoFactor } from "~/lib/app-sign-in.server"
import { readSmallJson } from "~/lib/request-body.server"
import type { Route } from "./+types/app.sign-in.two-factor"

/** `POST /app/sign-in/two-factor`: a sign-in's code, for an account with two-factor authentication. */
export async function action({ request }: Route.ActionArgs) {
	if (request.method !== "POST") return new Response(null, { status: 405 })
	try {
		const code = await appSignInTwoFactor(await readSmallJson(request), request.headers)
		return Response.json(code, { headers: { "cache-control": "no-store" } })
	} catch (error) {
		if (error instanceof AppError) return errorResponse(error)
		throw error
	}
}
