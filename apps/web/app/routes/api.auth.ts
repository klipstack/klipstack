import { auth } from "~/lib/auth.server"
import { handleProviderCallback } from "~/lib/provider-sign-in.server"
import { boundedRequest } from "~/lib/request-body.server"
import type { Route } from "./+types/api.auth"

export async function loader({ request }: Route.LoaderArgs) {
	if (new URL(request.url).pathname.startsWith("/api/auth/callback/"))
		return handleProviderCallback(request)
	return auth.handler(request)
}

export async function action({ request }: Route.ActionArgs) {
	return auth.handler(await boundedRequest(request))
}
