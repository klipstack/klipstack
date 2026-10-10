import { randomBytes } from "node:crypto"
import { db, eq, or, user } from "@klipstack/db"
import { auth } from "../../app/lib/auth.server"
import { assertOwned, EMAIL, loadState, loginLinkUrl } from "./local"

/** Long enough to open later from a thread; the account's password is public anyway. */
export const LINK_HOURS = 24

/**
 * A one-time sign-in link for the demo account: a magic-link token, written as the magic-link
 * plugin writes one, without sending email. Opening it runs better-auth's ordinary verification.
 */
export async function createLoginLink(options: {
	cache: string
	database: string
	storage: string
	baseUrl: string
}): Promise<string> {
	const saved = await loadState(options.cache, options.database, options.storage)
	const matches = await db
		.select({ id: user.id, email: user.email, emailVerified: user.emailVerified })
		.from(user)
		.where(saved ? or(eq(user.email, EMAIL), eq(user.id, saved.userId)) : eq(user.email, EMAIL))
	assertOwned(saved, matches)
	if (!saved || !matches.length) throw new Error("Demo account does not exist; run demo:seed")
	// For an unverified address, a magic link removes the password first: keep it as documented.
	if (!matches[0]!.emailVerified)
		throw new Error("Demo account email is unverified; use demo:reset")
	const token = randomBytes(32).toString("base64url")
	const context = await auth.$context
	await context.internalAdapter.createVerificationValue({
		identifier: token,
		value: JSON.stringify({ email: EMAIL }),
		expiresAt: new Date(Date.now() + LINK_HOURS * 3_600_000),
	})
	return loginLinkUrl(options.baseUrl, token)
}
