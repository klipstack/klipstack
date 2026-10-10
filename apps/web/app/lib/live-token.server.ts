import { consentedScopes, effectiveScopes } from "~/services/oauth-apps.server"
import { validGrant } from "./credential-policy.server"

/**
 * Who a verified access token speaks for, and the scopes it still has: those the app's consent holds
 * now, for a grant not revoked since. Null when the user disconnected the app. Access tokens are
 * stateless JWTs: disconnecting the app, or taking write access away in a later sign-in, only shows
 * up here. The HTTP API and MCP both ask.
 */
export async function liveTokenScopes(claims: {
	sub?: unknown
	client_id?: unknown
	azp?: unknown
	scope?: unknown
	klip_grant?: unknown
}): Promise<{ userId: string; clientId: string; scopes: string[] } | null> {
	const userId = typeof claims.sub === "string" ? claims.sub : null
	const clientId =
		typeof claims.client_id === "string"
			? claims.client_id
			: typeof claims.azp === "string"
				? claims.azp
				: null
	if (!userId || !clientId) return null
	const consented = await consentedScopes(userId, clientId)
	if (!consented || !(await validGrant(userId, clientId, claims.klip_grant))) return null
	return { userId, clientId, scopes: effectiveScopes(claims.scope, consented) }
}
