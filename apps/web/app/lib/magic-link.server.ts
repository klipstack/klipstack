import { and, db, eq, gt, user, verification } from "@klipstack/db"
import { authDb, withAuthTransaction } from "./auth-db.server"
import { auth } from "./auth.server"
import { invitesRequired } from "./env.server"
import { signupWithInvite } from "./invites.server"
import { SIGNED_IN_HOME } from "./session.server"
import { withLinkSignup, withSignupAllowed } from "./signup-gate.server"

/**
 * Request a magic link for an existing account. Unknown emails are ignored silently so the
 * caller can always show the same "check your inbox" screen, and strangers never receive mail
 * from us: the mailer skips them.
 */
export async function requestMagicLink(
	email: string,
	headers: Headers,
	callbackURL = SIGNED_IN_HOME,
): Promise<void> {
	const normalized = email.trim().toLowerCase()
	await auth.api.signInMagicLink({ body: { email: normalized, callbackURL }, headers })
}

/**
 * Email a link that creates the account when confirmed (/signup/confirm). The caller has checked
 * the invite: it is consumed on confirmation, with the account. An address that already has an
 * account gets its ordinary login link instead, so the answer never tells the two apart.
 */
export async function requestSignupLink(
	{
		name,
		email,
		inviteCode,
		locale,
	}: { name: string; email: string; inviteCode: string | null; locale: string },
	headers: Headers,
): Promise<void> {
	const normalized = email.trim().toLowerCase()
	await withLinkSignup({ inviteCode, locale }, () =>
		auth.api.signInMagicLink({
			body: { email: normalized, name, callbackURL: SIGNED_IN_HOME },
			headers,
		}),
	)
}

/** The address an unused, unexpired link token was issued for. Reading it does not use it up. */
export async function peekMagicLink(token: string): Promise<string | null> {
	if (!token) return null
	// better-auth's row for a link: the token as sent (stored plain), behind its purpose.
	const identifier = `magic-link:${token}`
	const [row] = await db
		.select({ value: verification.value })
		.from(verification)
		.where(and(eq(verification.identifier, identifier), gt(verification.expiresAt, new Date())))
		.limit(1)
	if (!row) return null
	try {
		const { email } = JSON.parse(row.value) as { email?: unknown }
		return typeof email === "string" ? email : null
	} catch {
		return null
	}
}

/**
 * Create the account a sign-up link stands for and sign it in. In invite mode the account, the
 * token and the invite commit together: a lost invite leaves the link usable with another one.
 */
export function confirmSignupLink(
	{ token, inviteCode, locale }: { token: string; inviteCode: string | undefined; locale: string },
	headers: Headers,
) {
	const create = async () => {
		// No callback URL: the endpoint answers with the new user instead of a redirect.
		const result = await auth.api.magicLinkVerify({
			query: { token },
			headers,
			returnHeaders: true,
		})
		// The link's endpoint creates the user without our additional fields.
		await authDb.update(user).set({ locale }).where(eq(user.id, result.response.user.id))
		return result
	}
	return invitesRequired
		? signupWithInvite(inviteCode, create)
		: withAuthTransaction(() => withSignupAllowed(create))
}
