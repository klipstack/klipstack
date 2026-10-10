import { oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider"
import { auth } from "~/lib/auth.server"
import type { Route } from "./+types/well-known.openid-configuration"

// Path-inserted OIDC discovery (/.well-known/openid-configuration/api/auth), which MCP clients try.
// The path-appended form (/api/auth/.well-known/openid-configuration) reaches the auth handler.
const metadata = oauthProviderOpenIdConfigMetadata(auth, {
	headers: { "Access-Control-Allow-Origin": "*" },
})

export function loader({ request }: Route.LoaderArgs) {
	return metadata(request)
}
