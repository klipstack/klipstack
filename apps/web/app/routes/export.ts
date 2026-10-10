import { errorResponse } from "~/api/errors.server"
import { AppError } from "~/lib/app-error"
import { downloadResponse } from "~/lib/download-response.server"
import { requireUser } from "~/lib/session.server"
import { downloadExport } from "~/services/export.server"
import type { Route } from "./+types/export"

/** GET /export?format=zip|json — everything the user owns, generated on the fly. */
export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	const format = new URL(request.url).searchParams.get("format") === "json" ? "json" : "zip"
	try {
		return downloadResponse(await downloadExport(user.id, format))
	} catch (error) {
		if (error instanceof AppError) throw errorResponse(error)
		throw error
	}
}
