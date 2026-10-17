import { LIBRARY_READ_SCOPE, LIBRARY_WRITE_SCOPE } from "@klipstack/api-contract/auth"
import { and, db, eq, gt, oauthClient, session } from "@klipstack/db"
import { isAPIError } from "better-auth/api"
import { requestToResourceInput, verifyAccessTokenRequest } from "better-auth/oauth2"
import { trustedAuthAddress } from "~/lib/auth-limits.server"
import { API_RESOURCE } from "~/lib/auth.server"
import { env, selfUrl } from "~/lib/env.server"
import { liveTokenScopes } from "~/lib/live-token.server"
import { countRefusedBearer, refusedBearerWait } from "~/lib/rate-limit.server"
import { namesKnownSigningKey } from "~/lib/signing-keys.server"
import { API_KEY_PREFIX, userForApiKey } from "~/services/api-keys.server"
import { ApiError, insufficientScope, rateLimited, unauthorized } from "./errors.server"

/**
 * Who is calling the API. Bearer tokens only: an API key (`klip_…`, full access) or an OAuth access
 * token issued for the `/api` resource with `library:read` and, for writes, `library:write`.
 * Cookies are ignored, so browser sessions cannot call the API and there is no CSRF surface.
 */
export interface ApiPrincipal {
	userId: string
	access: "read" | "write"
	via: "api_key" | "oauth"
	/** The OAuth client id; null for an API key. */
	clientId: string | null
	/**
	 * The browser session the OAuth sign-in went through (the token's `sid`, which refreshes keep):
	 * when it was created is when the user signed in. Null for an API key.
	 */
	sessionId: string | null
}

export async function authenticateApiRequest(request: Request): Promise<ApiPrincipal> {
	const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]
	if (!bearer) throw unauthorized("Send an API key or an access token as a bearer token.", false)
	// Past too many refused tokens, an address is refused before the lookup.
	const address = trustedAuthAddress(request.headers)
	const wait = refusedBearerWait(address)
	if (wait !== null) throw rateLimited(wait)
	try {
		return await principalFor(bearer, request)
	} catch (error) {
		if (error instanceof ApiError && error.status === 401) countRefusedBearer(address)
		throw error
	}
}

async function principalFor(bearer: string, request: Request): Promise<ApiPrincipal> {
	if (bearer.startsWith(API_KEY_PREFIX)) {
		const user = await userForApiKey(bearer)
		if (!user) throw unauthorized("Invalid API key.", true)
		// API keys can already do everything in the account.
		return { userId: user.id, access: "write", via: "api_key", clientId: null, sessionId: null }
	}

	const invalid = () => unauthorized("Invalid or expired access token.", true)
	// A made-up key id would make the verifier fetch our key set on every request.
	if (!(await namesKnownSigningKey(bearer))) throw invalid()
	let claims: Awaited<ReturnType<typeof verifyAccessTokenRequest>>
	try {
		claims = await verifyAccessTokenRequest(requestToResourceInput(request), {
			verifyOptions: { issuer: `${env.APP_URL}/api/auth`, audience: API_RESOURCE },
			// Verify against our own keys without a round trip through the public proxy.
			jwksUrl: `${selfUrl}/api/auth/jwks`,
		})
	} catch (error) {
		// The verifier reports a bad token as 401; anything else (our key set unreachable) is ours.
		if (isAPIError(error) && error.status === "UNAUTHORIZED") throw invalid()
		throw error
	}
	const live = await liveTokenScopes(claims)
	if (!live) throw unauthorized("The user disconnected this app.", true)
	const { userId, clientId } = live
	const scopes = new Set(live.scopes)
	if (!scopes.has(LIBRARY_READ_SCOPE)) throw insufficientScope(LIBRARY_READ_SCOPE)
	return {
		userId,
		access: scopes.has(LIBRARY_WRITE_SCOPE) ? "write" : "read",
		via: "oauth",
		clientId,
		sessionId: typeof claims.sid === "string" ? claims.sid : null,
	}
}

/**
 * When the user signed in to get this token: its browser session's creation, the time the web's
 * recent sign-in checks. Null when the token names no session, or one that is not the user's or
 * has ended (signed out, expired).
 */
export async function signedInAt(principal: ApiPrincipal): Promise<Date | null> {
	if (!principal.sessionId) return null
	const [row] = await db
		.select({ createdAt: session.createdAt })
		.from(session)
		.where(
			and(
				eq(session.id, principal.sessionId),
				eq(session.userId, principal.userId),
				gt(session.expiresAt, new Date()),
			),
		)
	return row?.createdAt ?? null
}

/** The client's display name, for `GET /me`. */
export async function oauthClientName(clientId: string): Promise<string> {
	const [row] = await db
		.select({ name: oauthClient.name })
		.from(oauthClient)
		.where(eq(oauthClient.clientId, clientId))
		.limit(1)
	return row?.name ?? clientId
}
