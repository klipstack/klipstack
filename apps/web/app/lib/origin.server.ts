import { AppError } from "./app-error"
import { env } from "./env.server"

/**
 * Browsers send Origin on every POST. A missing or foreign one is not our form. Compared with
 * APP_URL, never the request's own URL: behind a proxy that comes from forwarding headers.
 */
export function sameOrigin(request: Request): boolean {
	const origin = request.headers.get("origin")
	return !!origin && origin === new URL(env.APP_URL).origin
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])
const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-)?klip\.session_token=[^;\s]/
/** The browser extension saves with the browser's session from its own origin. */
const EXTENSION_ORIGIN = /^(?:chrome-extension|moz-extension|safari-web-extension):\/\/[^/]+$/

/**
 * Whether a write that carries the session cookie may reach its route. React Router refuses a
 * cross-origin action only for pages; resource routes (an action and no component) get no check,
 * and SameSite=Lax still sends the cookie from sibling subdomains. So every write with the cookie
 * must come from APP_URL's origin, with two exceptions:
 * - `/api/auth/*`: better-auth checks the origin of cookie-carrying writes itself, against the same
 *   origin (`trustedOrigins` defaults to its `baseURL`, APP_URL).
 * - `/api/documents`: the browser extension saves from its own origin (`chrome-extension://…`,
 *   `moz-extension://…`), or none, with the browser's session. An extension that can send this
 *   cookie has the reader's host permission for this site already.
 * Writes without the cookie (signed out, the iPhone app) or with a bearer token (signed out by
 * `sessionMiddleware`) have no session to misuse, and are not checked here.
 */
export function crossSiteAllowed(request: Request): boolean {
	if (SAFE_METHODS.has(request.method)) return true
	if (!SESSION_COOKIE.test(request.headers.get("cookie") ?? "")) return true
	if (sameOrigin(request)) return true
	const { pathname } = new URL(request.url)
	if (pathname.startsWith("/api/auth/")) return true
	if (pathname === "/api/documents") {
		const origin = request.headers.get("origin")
		return origin === null || EXTENSION_ORIGIN.test(origin)
	}
	return false
}

/** The answer to a write `crossSiteAllowed` refuses, in the shape every error has. */
export function crossSiteRefusal(): Response {
	const error = new AppError("forbidden", "This request did not come from Klipstack's own pages.")
	return Response.json({ error: error.body }, { status: error.status })
}
