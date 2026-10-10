import { redirect } from "react-router"
import { requireUser } from "~/lib/session.server"
import { SETTINGS_HOME } from "~/lib/settings-origin"
import type { Route } from "./+types/settings.index"

/** `/settings` opens the first section; older links (`/settings?error=…`) keep their query. */
export function loader({ context, request }: Route.LoaderArgs) {
	requireUser(context, request)
	throw redirect(SETTINGS_HOME + new URL(request.url).search)
}
