import { MOBILE_CALLBACK_PATH } from "@klipstack/api-contract/auth"
import { env } from "~/lib/env.server"

/**
 * GET /.well-known/apple-app-site-association: which iPhone app may open which of this server's
 * links. Only the app's sign-in callback: every other link stays on the web. `webcredentials` lets
 * the sign-in sheet (`ASWebAuthenticationSession`) hand an https callback to the app. Without a
 * configured team (self-hosters, and until the app has one) there is no such app: 404.
 */
export function loader() {
	const { APPLE_TEAM_ID: team, APPLE_BUNDLE_ID: bundle } = env
	if (!team || !bundle) return new Response("Not found", { status: 404 })
	const appID = `${team}.${bundle}`
	return Response.json({
		applinks: {
			details: [
				{
					appIDs: [appID],
					components: [{ "/": MOBILE_CALLBACK_PATH, comment: "The app's sign-in callback" }],
				},
			],
		},
		webcredentials: { apps: [appID] },
	})
}
