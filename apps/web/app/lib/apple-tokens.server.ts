import { account, and, db, eq } from "@klipstack/db"
import { logError } from "@klipstack/log"
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto"
import { appleApp, env, oauth } from "./env.server"

/**
 * Apple's refresh tokens, kept for one thing: revoking the person's Sign in with Apple when the
 * account is deleted or Apple is disconnected, as Apple requires. Klipstack never refreshes them
 * or calls any other Apple API. No other provider's tokens are kept (`NO_PROVIDER_TOKENS`).
 */

const TOKEN_URL = "https://appleid.apple.com/auth/token"
const REVOKE_URL = "https://appleid.apple.com/auth/revoke"
const TIMEOUT_MS = 10_000

type Sealed = { clientId: string; refreshToken: string }

/**
 * Apple's refresh token as `account.refresh_token` keeps it: with the client Apple issued it to
 * (the web's Services ID or the app's bundle ID, whose secret revokes it), encrypted with
 * BETTER_AUTH_SECRET. A token sealed under another secret can't be opened: it is not revoked.
 */
export function sealAppleToken(clientId: string, refreshToken: string): Promise<string> {
	return symmetricEncrypt({
		key: env.BETTER_AUTH_SECRET,
		data: JSON.stringify({ clientId, refreshToken } satisfies Sealed),
	})
}

async function openAppleToken(sealed: string): Promise<Sealed | null> {
	try {
		const value = JSON.parse(await symmetricDecrypt({ key: env.BETTER_AUTH_SECRET, data: sealed }))
		return typeof value?.clientId === "string" && typeof value?.refreshToken === "string"
			? value
			: null
	} catch {
		return null
	}
}

/** The secret of the client Apple issued a token to: the web's or the app's. */
function secretFor(clientId: string): string | null {
	if (oauth.apple && clientId === oauth.apple.clientId) return oauth.apple.clientSecret
	if (appleApp && clientId === appleApp.clientId) return appleApp.clientSecret
	return null
}

/**
 * Exchanges the authorization code Apple's sheet gave the app. A code works once, for five
 * minutes: its exchange proves the sign-in happened now, which the ID token alone does not.
 * Answers the `sub` of the person Apple signed in, and their refresh token.
 */
export async function exchangeAppleAppCode(
	code: string,
): Promise<{ subject: string; refreshToken: string } | null> {
	if (!appleApp) return null
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
		body: new URLSearchParams({
			client_id: appleApp.clientId,
			client_secret: appleApp.clientSecret,
			code,
			grant_type: "authorization_code",
		}),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	})
	if (!response.ok) return null
	const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
	if (typeof body.refresh_token !== "string" || typeof body.id_token !== "string") return null
	// Straight from Apple over TLS, for this client: its subject needs no signature check.
	const sub = claimsOf(body.id_token)?.sub
	return typeof sub === "string" ? { subject: sub, refreshToken: body.refresh_token } : null
}

/** A JWT's claims, unverified. */
export function claimsOf(jwt: string): Record<string, unknown> | null {
	try {
		const claims = JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString())
		return claims && typeof claims === "object" ? claims : null
	} catch {
		return null
	}
}

/** Keeps the app's Apple token on the account's Apple link, replacing any earlier one. */
export async function keepAppleAppToken(userId: string, subject: string, refreshToken: string) {
	if (!appleApp) return
	await db
		.update(account)
		.set({ refreshToken: await sealAppleToken(appleApp.clientId, refreshToken) })
		.where(
			and(
				eq(account.userId, userId),
				eq(account.providerId, "apple"),
				eq(account.accountId, subject),
			),
		)
}

/**
 * Revokes the account's Sign in with Apple at Apple, if it keeps a token: Apple then forgets the
 * link, and the person's Apple ID no longer lists Klipstack. Best effort: a failure is logged and
 * the caller goes on (deleting the account, disconnecting Apple).
 */
export async function revokeAppleSignIn(userId: string): Promise<void> {
	const links = await db
		.select({ refreshToken: account.refreshToken })
		.from(account)
		.where(and(eq(account.userId, userId), eq(account.providerId, "apple")))
	for (const { refreshToken } of links) {
		if (!refreshToken) {
			console.warn("[apple] no token to revoke: linked before tokens were kept")
			continue
		}
		const sealed = await openAppleToken(refreshToken)
		if (sealed) await revoke(sealed)
		else console.warn("[apple] the kept token can't be used: another secret or client")
	}
}

/**
 * Revokes the token Apple's sheet just gave the app, when it signed no one in: the person's Apple
 * ID doesn't list Klipstack for an account that doesn't exist. Best effort.
 */
export async function revokeAppleAppToken(refreshToken: string): Promise<void> {
	if (appleApp) await revoke({ clientId: appleApp.clientId, refreshToken })
}

async function revoke({ clientId, refreshToken }: Sealed): Promise<void> {
	const secret = secretFor(clientId)
	if (!secret) return console.warn("[apple] the kept token can't be used: another secret or client")
	try {
		const response = await fetch(REVOKE_URL, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: clientId,
				client_secret: secret,
				token: refreshToken,
				token_type_hint: "refresh_token",
			}),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		})
		if (!response.ok) console.warn(`[apple] revoking failed: ${response.status}`)
	} catch (error) {
		logError("[apple] revoking failed", error)
	}
}
