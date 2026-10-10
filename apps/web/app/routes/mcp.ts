import { requireMcpAuth } from "@better-auth/mcp"
import { createResourceServerChallenge } from "@better-auth/oauth-provider"
import { type AuthInfo, createMcpHandler } from "@modelcontextprotocol/server"
import { APIError } from "better-auth/api"
import { createInsufficientScopeError } from "better-auth/oauth2"
import { LIBRARY_READ_SCOPE, LIBRARY_WRITE_SCOPE } from "~/lib/auth-constants"
import { trustedAuthAddress } from "~/lib/auth-limits.server"
import { auth, MCP_RESOURCE } from "~/lib/auth.server"
import { selfUrl } from "~/lib/env.server"
import { liveTokenScopes } from "~/lib/live-token.server"
import {
	countRefusedBearer,
	MCP_LIMIT,
	rateLimit,
	refusedBearerWait,
} from "~/lib/rate-limit.server"
import { boundedRequest } from "~/lib/request-body.server"
import { namesKnownSigningKey } from "~/lib/signing-keys.server"
import { API_KEY_PREFIX, userForApiKey } from "~/services/api-keys.server"
import { createLibraryMcpServer, WRITE_TOOLS } from "~/services/mcp/index.server"
import type { Route } from "./+types/mcp"

/**
 * POST /mcp — the MCP server (stateless; 2026-07-28 and 2025-era clients).
 *
 * Callers authenticate with an OAuth access token issued for this resource with the library:read
 * scope, or with a Klipstack API key (`klip_…`) for clients without OAuth. Without either, the
 * 401 points clients at the protected resource metadata so they can start the OAuth flow.
 *
 * Connecting asks for reading only. Calling a write tool without library:write gets a 403
 * `insufficient_scope` challenge, so the client asks the user for that scope when it needs it.
 */

const REQUIRED_SCOPES = [LIBRARY_READ_SCOPE]
const WRITE_SCOPES = [LIBRARY_WRITE_SCOPE]

const mcp = createMcpHandler((ctx) => {
	const userId = ctx.authInfo?.extra?.userId
	if (typeof userId !== "string") throw new Error("MCP request without an authenticated user")
	return createLibraryMcpServer(userId, { canWrite: ctx.authInfo?.extra?.canWrite === true })
})

const withOAuth = requireMcpAuth(
	auth,
	async (request, claims) => {
		const live = await liveTokenScopes(claims)
		if (!live) return unauthorized("The user disconnected this app")
		const { userId, clientId, scopes } = live
		if (!scopes.includes(LIBRARY_READ_SCOPE))
			throw createInsufficientScopeError(REQUIRED_SCOPES, "Reading the library needs library:read")
		const body = await readBody(request, userId)
		if (body instanceof Response) return body
		if (!scopes.includes(LIBRARY_WRITE_SCOPE) && (await callsWriteTool(body)))
			throw createInsufficientScopeError(WRITE_SCOPES, "Changing the library needs library:write")
		return serve(body, authInfo(clientId, scopes, userId, claims.exp))
	},
	{
		resource: MCP_RESOURCE,
		requiredScopes: REQUIRED_SCOPES,
		// Verify against our own keys without a round trip through the public proxy.
		jwksUrl: `${selfUrl}/api/auth/jwks`,
	},
)

/** Whether the JSON-RPC request calls one of the write tools. */
async function callsWriteTool(request: Request): Promise<boolean> {
	try {
		const body = (await request.clone().json()) as { method?: unknown; params?: { name?: unknown } }
		return (
			body.method === "tools/call" &&
			typeof body.params?.name === "string" &&
			WRITE_TOOLS.has(body.params.name)
		)
	} catch {
		return false
	}
}

function serve(request: Request, info: AuthInfo & { extra: { userId: string } }) {
	const limited = rateLimit(`mcp:${info.extra.userId}`, MCP_LIMIT.limit, MCP_LIMIT.windowMs)
	if (!limited.ok) return tooManyRequests(limited.retryAfterSeconds)
	return mcp.fetch(request, { authInfo: info })
}

function tooManyRequests(retryAfterSeconds: number) {
	return Response.json(
		{ jsonrpc: "2.0", error: { code: -32000, message: "Too many requests" }, id: null },
		{ status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
	)
}

function authInfo(clientId: string, scopes: string[], userId: string, exp?: number) {
	return {
		token: "",
		clientId,
		scopes,
		expiresAt: exp,
		resource: new URL(MCP_RESOURCE),
		extra: { userId, canWrite: scopes.includes(LIBRARY_WRITE_SCOPE) },
	}
}

/** A 401 with the same discovery challenge an unauthenticated request gets. */
function unauthorized(message: string) {
	const challenge = createResourceServerChallenge(
		new APIError("UNAUTHORIZED", { message }),
		MCP_RESOURCE,
		{ challengeScopes: REQUIRED_SCOPES },
	)
	const headers = new Headers(challenge?.headers)
	headers.set("Content-Type", "application/json")
	return new Response(
		JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }),
		{ status: 401, headers },
	)
}

/**
 * The body, read only once the caller is known: a stranger's slow upload must not hold one of
 * the reads every form and sign-in shares (`boundedRequest`). A refusal comes back as a Response.
 */
async function readBody(request: Request, userId: string): Promise<Request | Response> {
	try {
		return await boundedRequest(request, 1024 * 1024, userId)
	} catch (error) {
		if (error instanceof Response) return error
		throw error
	}
}

async function handle(request: Request) {
	const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]
	if (!bearer) return authenticate(request, bearer)
	// Past too many refused tokens, an address is refused before the lookup.
	const address = trustedAuthAddress(request.headers)
	const wait = refusedBearerWait(address)
	if (wait !== null) return tooManyRequests(wait)
	const response = await authenticate(request, bearer)
	if (response.status === 401) countRefusedBearer(address)
	return response
}

async function authenticate(request: Request, bearer: string | undefined) {
	if (bearer?.startsWith(API_KEY_PREFIX)) {
		const user = await userForApiKey(bearer)
		if (!user) return unauthorized("Invalid API key")
		const body = await readBody(request, user.id)
		if (body instanceof Response) return body
		// API keys can already do everything in the account.
		return serve(body, authInfo("api-key", [...REQUIRED_SCOPES, ...WRITE_SCOPES], user.id))
	}
	// A made-up key id would make the verifier fetch our key set on every request.
	if (bearer && !(await namesKnownSigningKey(bearer))) return unauthorized("Invalid access token")
	return withOAuth(request)
}

export function action({ request }: Route.ActionArgs) {
	return handle(request)
}

// GET gets the same auth challenge; authenticated, the stateless server answers 405.
export function loader({ request }: Route.LoaderArgs) {
	return handle(request)
}
