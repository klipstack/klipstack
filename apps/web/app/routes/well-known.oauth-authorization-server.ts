import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider"
import { auth } from "~/lib/auth.server"
import type { Route } from "./+types/well-known.oauth-authorization-server"

// The issuer is https://…/api/auth, so RFC 8414 clients look for /.well-known/oauth-authorization-server/api/auth.
const metadata = oauthProviderAuthServerMetadata(auth, {
	headers: { "Access-Control-Allow-Origin": "*" },
})

export function loader({ request }: Route.LoaderArgs) {
	return metadata(request)
}
