import { errorResponse } from "~/api/errors.server"
import { AppError } from "~/lib/app-error"
import { appSignIn, appSignInOptions } from "~/lib/app-sign-in.server"
import { readSmallJson } from "~/lib/request-body.server"
import type { Route } from "./+types/app.sign-in"

/** `GET /app/sign-in`: the ways in the iPhone app's sign-in screen offers. */
export function loader() {
	return Response.json(appSignInOptions(), { headers: { "cache-control": "no-store" } })
}

/** `POST /app/sign-in`: one way in; the authorization code for the app (`appSignIn`). */
export async function action({ request }: Route.ActionArgs) {
	if (request.method !== "POST") return new Response(null, { status: 405 })
	try {
		const code = await appSignIn(await readSmallJson(request), request.headers)
		return Response.json(code, { headers: { "cache-control": "no-store" } })
	} catch (error) {
		if (error instanceof AppError) return errorResponse(error)
		throw error
	}
}
