import type { GenericEndpointContext } from "better-auth"
import { createAuthMiddleware } from "better-auth/api"
import { deleteSessionCookie } from "better-auth/cookies"
import { generateRandomString } from "better-auth/crypto"
import { TWO_FACTOR_MINUTES } from "./auth-constants"

/**
 * better-auth's two-factor plugin asks for the code after a password only. Every other way in
 * makes its session here, and this hook stops it the same way: the session is ended before the
 * browser gets it, and a pending sign-in (the plugin's own signed `two_factor` cookie, which its
 * verify endpoints finish) takes its place.
 *
 * A link or a provider's callback redirects: to /login/code, which goes on to where it was going.
 * An endpoint that answers data (the iPhone app's emailed code, Apple's ID token, both in process)
 * answers the plugin's `{ twoFactorRedirect: true }`, as a password does.
 *
 * Runs as the auth config's own after-hook: those run before every plugin's, the OAuth provider's
 * included, which would otherwise resume an app's authorization with the session.
 */
const GATED = new Set([
	"/magic-link/verify",
	"/callback/:id",
	"/sign-in/email-otp",
	"/sign-in/social",
])

export const twoFactorGate = createAuthMiddleware(async (ctx) => {
	if (!ctx.path || !GATED.has(ctx.path)) return
	const created = ctx.context.newSession
	if (!created?.user.twoFactorEnabled) return
	await toPendingSignIn(ctx, created.user.id, created.session.token)
	const returned = ctx.context.returned
	const location =
		returned instanceof Error && "headers" in returned
			? new Headers(returned.headers as HeadersInit).get("location")
			: null
	if (location === null) return ctx.json({ twoFactorRedirect: true, twoFactorMethods: ["totp"] })
	const next = new URLSearchParams()
	const target = new URL(location, ctx.context.baseURL)
	if (target.origin === new URL(ctx.context.baseURL).origin)
		next.set("redirectTo", target.pathname + target.search)
	throw ctx.redirect(`/login/code?${next}`)
})

/** What the plugin does after a password: the session ends, a pending sign-in replaces it. */
async function toPendingSignIn(ctx: GenericEndpointContext, userId: string, sessionToken: string) {
	deleteSessionCookie(ctx, true)
	await ctx.context.internalAdapter.deleteSession(sessionToken)
	ctx.context.setNewSession(null)
	const maxAge = TWO_FACTOR_MINUTES * 60
	const identifier = `2fa-${generateRandomString(20)}`
	const expiresAt = new Date(Date.now() + maxAge * 1000)
	await ctx.context.internalAdapter.createVerificationValue({
		value: userId,
		identifier,
		expiresAt,
	})
	// The plugin's count of codes tried for this sign-in (5 at most).
	await ctx.context.internalAdapter.createVerificationValue({
		value: "0",
		identifier: `2fa-attempts-${identifier}`,
		expiresAt,
	})
	const cookie = ctx.context.createAuthCookie("two_factor", { maxAge })
	await ctx.setSignedCookie(cookie.name, identifier, ctx.context.secret, cookie.attributes)
}
