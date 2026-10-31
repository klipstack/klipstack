import { APIError } from "better-auth/api"
import { constantTimeEqual, makeSignature } from "better-auth/crypto"
import { env } from "./env.server"

/**
 * The OAuth provider sends users to /login and /oauth/consent with the authorization request in the
 * query, signed (`sig`) and listing its signed parameter names (`ba_param`). Its endpoints take that
 * query back as `oauth_query` to resume the flow. Returns null when the URL carries no such query.
 */
export function signedOAuthQuery(url: URL): string | null {
	const params = url.searchParams
	const names = new Set(params.getAll("ba_param"))
	if (!params.has("sig") || names.size === 0) return null
	const signed = new URLSearchParams()
	for (const [key, value] of params) {
		if (key === "sig" || key === "ba_param" || names.has(key)) signed.append(key, value)
	}
	return signed.toString()
}

/**
 * Where the app of an authorization request gets the browser back (its `redirect_uri`): a page that
 * resumes the request lets its forms go on there (`allowFormTargets`). Only for a query the page
 * verified; the provider signed it after checking the address against the app's.
 */
export function oauthRedirectUri(query: string | null): string | null {
	return query ? new URLSearchParams(query).get("redirect_uri") : null
}

/**
 * Whether a signed OAuth query is intact and unexpired, so a page never shows a tampered request.
 * Mirrors the provider's own check (HMAC over the sorted parameters); the provider verifies again
 * when the query comes back.
 */
export async function verifySignedOAuthQuery(query: string): Promise<boolean> {
	const exp = Number(new URLSearchParams(query).get("exp"))
	return (await signatureHolds(query)) && exp * 1000 >= Date.now()
}

/**
 * The app whose authorization request this page is part of (its `client_id`), from the signed query
 * in its address, or null. An expired query still names its app: the page is still in that app's
 * sign-in, though it can no longer resume it.
 */
export async function oauthClientOf(url: URL): Promise<string | null> {
	const query = signedOAuthQuery(url)
	if (!query || !(await signatureHolds(query))) return null
	return new URLSearchParams(query).get("client_id")
}

/**
 * The signed query of the app's sign-in this page is part of, expired or not, for its links to
 * carry: the pages they lead to stay in that sign-in (the app's providers, the way back to /login).
 * Null outside one.
 */
export async function appSignInQuery(url: URL): Promise<string | null> {
	return (await oauthClientOf(url)) ? signedOAuthQuery(url) : null
}

async function signatureHolds(query: string): Promise<boolean> {
	const params = new URLSearchParams(query)
	const sigs = params.getAll("sig")
	params.delete("sig")
	const sorted = [...params].sort(([ka, va], [kb, vb]) =>
		ka === kb ? (va < vb ? -1 : va > vb ? 1 : 0) : ka < kb ? -1 : 1,
	)
	const expected = await makeSignature(
		new URLSearchParams(sorted).toString(),
		env.BETTER_AUTH_SECRET,
	)
	return sigs.length === 1 && constantTimeEqual(sigs[0] ?? "", expected)
}

/**
 * Request context for server-side calls into the OAuth provider. Its authorize step needs the
 * request, and with `accept: application/json` its endpoints return `{ redirect, url }` instead of
 * throwing a redirect. The body is passed separately; the request's own body is not read again.
 * (A call given a request answers with a Response unless told otherwise.)
 */
export function oauthApiContext(request: Request) {
	const headers = new Headers(request.headers)
	headers.set("accept", "application/json")
	return { request, headers, asResponse: false as const }
}

/** Where the OAuth provider wants the browser to go next, from an endpoint's result or error. */
export function oauthRedirectUrl(result: unknown): string | null {
	if (result instanceof APIError) return new Headers(result.headers).get("location")
	if (!result || typeof result !== "object") return null
	const r = result as { redirect?: unknown; url?: unknown; redirect_uri?: unknown }
	if (typeof r.url === "string" && r.redirect) return r.url
	if (typeof r.redirect_uri === "string") return r.redirect_uri
	return null
}

/**
 * What the consent screen shows about the requesting app. The name is whatever the app says, so the
 * screen also shows the hosts that vouch for it: the client ID (for apps identified by a metadata
 * URL) and where the browser goes afterwards.
 */
export function describeOAuthRequest(url: URL, clientName: string | null | undefined) {
	const clientId = url.searchParams.get("client_id") ?? ""
	const clientHost = httpsHost(clientId)
	return {
		name: clientName?.trim() || clientHost || clientId,
		clientHost,
		redirectTarget: displayTarget(url.searchParams.get("redirect_uri")),
		scopes: (url.searchParams.get("scope") ?? "").split(" ").filter(Boolean),
	}
}

/** The host of an https URL (how URL-identified OAuth clients are shown), or null. */
export function httpsHost(value: string): string | null {
	try {
		const u = new URL(value)
		return u.protocol === "https:" ? u.host : null
	} catch {
		return null
	}
}

function displayTarget(value: string | null): string | null {
	if (!value) return null
	try {
		const u = new URL(value)
		if (u.protocol === "http:" || u.protocol === "https:") return u.host
		return `${u.protocol}//${u.host}`
	} catch {
		return null
	}
}
