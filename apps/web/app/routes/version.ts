import { appVersion } from "~/lib/env.server"

/** GET /version → the commit the server is running, for the app to spot a deploy. */
export function loader() {
	return Response.json({ version: appVersion }, { headers: { "Cache-Control": "no-store" } })
}
