import { db, eq, session as sessions } from "@klipstack/db"
import {
	createContext,
	type MiddlewareFunction,
	type RouterContextProvider,
	redirect,
} from "react-router"
import { auth, type SessionData } from "./auth.server"
import { cacheIdentity } from "./cache-identity.server"
import { BASE_POLICY } from "./csp.server"
import { LAYOUT_COOKIE } from "./list-layout"
import { NOTEBOOK_VIEW_COOKIE } from "./notebook-filters"
import { SIDEBAR_COOKIE } from "./sidebar"

export const sessionContext = createContext<SessionData | null>(null)

/**
 * Resolves the caller from the browser session cookie. A request with a bearer token is signed
 * out here, whatever cookies it has: API keys and OAuth tokens work only where they are checked
 * (`/api/v1/*`, `/mcp`, the OAuth endpoints), so a leaked key can't act as the user in the app.
 */
export const sessionMiddleware: MiddlewareFunction<Response> = async (
	{ request, context },
	next,
) => {
	if (/^Bearer\s/i.test(request.headers.get("authorization") ?? "")) {
		context.set(sessionContext, null)
		return next()
	}
	const session = await auth.api.getSession({ headers: request.headers })
	context.set(sessionContext, session ?? null)
	const response = await next()
	let current = session
	const authCookies = response.headers
		.getSetCookie()
		.filter((cookie) => /^(?:__Secure-)?klip\.session_token=/.test(cookie))
	if (authCookies.length) {
		const headers = new Headers(request.headers)
		headers.set("cookie", authCookies.map((cookie) => cookie.split(";")[0]).join("; "))
		current = await auth.api.getSession({ headers })
	}
	response.headers.set("X-Klipstack-Session", cacheIdentity(current?.session.id))
	response.headers.set("Cache-Control", "private, no-store")
	response.headers.set("X-Frame-Options", "DENY")
	response.headers.set("X-Content-Type-Options", "nosniff")
	// Pages keep their addresses to themselves. A public edition lets the sites it links to see this
	// origin, never its path: the one other policy a route may set.
	if (response.headers.get("Referrer-Policy") !== "strict-origin-when-cross-origin")
		response.headers.set("Referrer-Policy", "same-origin")
	// Only the home page belongs in search results. Crawlers must still fetch a page to see this.
	if (new URL(request.url).pathname !== "/") response.headers.set("X-Robots-Tag", "noindex")
	// Rendered pages already carry a fuller policy with their script nonce (entry.server.tsx).
	if (!response.headers.has("Content-Security-Policy"))
		response.headers.set("Content-Security-Policy", BASE_POLICY)
	return response
}

export function getSession(context: Readonly<RouterContextProvider>): SessionData | null {
	return context.get(sessionContext)
}

export function getUser(context: Readonly<RouterContextProvider>) {
	return getSession(context)?.user ?? null
}

export function requireUser(context: Readonly<RouterContextProvider>, request: Request) {
	const session = getSession(context)
	if (!session) {
		const url = new URL(request.url)
		const redirectTo = url.pathname + url.search
		const params =
			redirectTo && redirectTo !== "/" ? `?redirectTo=${encodeURIComponent(redirectTo)}` : ""
		throw redirect(`/login${params}`)
	}
	return session.user
}

/**
 * Where signing in lands when no page asked for another (`redirectTo`), and where signed-in
 * visitors to the login and signup pages go.
 */
export const SIGNED_IN_HOME = "/home"

export function requireAnonymous(context: Readonly<RouterContextProvider>) {
	if (getSession(context)) throw redirect(SIGNED_IN_HOME)
}

const REDIRECT_BASE = "http://klipstack.invalid"

/**
 * Only allow same-origin relative paths as post-login destinations. Browsers drop tabs and
 * newlines from a URL, so "/\t/evil.example" would land on "//evil.example": control characters
 * are refused, and what is left must resolve to this origin.
 */
export function safeRedirect(to: string | null | undefined, fallback = SIGNED_IN_HOME) {
	// oxlint-disable-next-line no-control-regex
	if (!to?.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(to)) return fallback
	if (new URL(to, REDIRECT_BASE).origin !== REDIRECT_BASE) return fallback
	return to
}

/** Copy `set-cookie` headers from a better-auth response onto a new Headers object. */
export function cookieHeadersFrom(source: Headers, extra?: Headers): Headers {
	const headers = new Headers(extra)
	for (const cookie of source.getSetCookie()) headers.append("set-cookie", cookie)
	return headers
}

/** Signs the request's session out; the headers clear its cookie and the per-user UI cookies. */
export async function signOutHeaders(request: Request): Promise<Headers> {
	const response = await auth.api.signOut({ headers: request.headers, asResponse: true })
	const headers = cookieHeadersFrom(response.headers)
	for (const name of [LAYOUT_COOKIE, SIDEBAR_COOKIE, NOTEBOOK_VIEW_COOKIE])
		headers.append("Set-Cookie", `${name}=; Path=/; Max-Age=0; SameSite=Lax`)
	return headers
}

/**
 * Confirms the signed-in person by their password, without signing out: a new session for the same
 * account replaces this one, and counts as a recent sign-in (`./recent-sign-in.server`). The email
 * is the session's own, so no one else can sign in here, and guesses count against the login's
 * limit (`/sign-in/email`). Returns the new session's cookie; throws better-auth's `APIError` for a
 * wrong password or the limit (429).
 */
export async function confirmPassword(
	request: Request,
	current: SessionData,
	password: string,
): Promise<Headers> {
	const { headers } = await auth.api.signInEmail({
		body: { email: current.user.email, password },
		headers: request.headers,
		returnHeaders: true,
	})
	await db.delete(sessions).where(eq(sessions.id, current.session.id))
	return cookieHeadersFrom(headers)
}
