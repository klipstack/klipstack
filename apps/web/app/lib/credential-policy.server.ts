import { getCurrentAuthContext } from "@better-auth/core/context"
import type { OAuthProviderExtension } from "@better-auth/oauth-provider"
import { MOBILE_CLIENT_ID } from "@klipstack/api-contract/auth"
import {
	and,
	apiKeys,
	db,
	eq,
	gt,
	isNull,
	newId,
	oauthAccessToken,
	oauthConsent,
	oauthGrants,
	oauthRefreshToken,
	session,
	type Tx,
	user,
} from "@klipstack/db"
import { APIError } from "better-auth/api"
import { reauthenticationRequired, signedInRecently } from "./recent-sign-in.server"

export function verificationRequired(): APIError {
	return new APIError("FORBIDDEN", {
		code: "EMAIL_VERIFICATION_REQUIRED",
		message: "Verify your email before creating an API key or connecting an app.",
	})
}

/** Checks the session is live and its account verified; returns when it signed in. */
async function verifiedSession(userId: string, sessionId: string | undefined) {
	if (!sessionId) throw verificationRequired()
	const [owner] = await db
		.select({ id: user.id, signedInAt: session.createdAt })
		.from(user)
		.innerJoin(session, eq(session.userId, user.id))
		.where(
			and(
				eq(user.id, userId),
				eq(user.emailVerified, true),
				eq(session.id, sessionId),
				gt(session.expiresAt, new Date()),
			),
		)
	if (!owner) throw verificationRequired()
	return owner.signedInAt
}

/** Whether the user has connected this app already (and not disconnected it since). */
export async function hasGrant(userId: string, clientId: string): Promise<boolean> {
	const [grant] = await db
		.select({ userId: oauthGrants.userId })
		.from(oauthGrants)
		.where(and(eq(oauthGrants.userId, userId), eq(oauthGrants.clientId, clientId)))
	return Boolean(grant)
}

/**
 * Ends every durable credential of the account: its API keys, and each connected app's consent,
 * grant and tokens. The same set as the first verification's trigger (migration 0013). Browser
 * sessions are the caller's: a password reset already ends them.
 */
export async function revokeCredentials(tx: Tx, userId: string) {
	await tx
		.update(apiKeys)
		.set({ revokedAt: new Date() })
		.where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
	await tx.delete(oauthGrants).where(eq(oauthGrants.userId, userId))
	await tx.delete(oauthConsent).where(eq(oauthConsent.userId, userId))
	await tx.delete(oauthRefreshToken).where(eq(oauthRefreshToken.userId, userId))
	await tx.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, userId))
}

/**
 * The provider carries this reference from authorization code through every refresh. A new
 * connection (no grant yet for this app) needs a recent sign-in: a stolen session must not connect
 * an app of its own that outlives a password reset. Whichever endpoint grants consent, it comes
 * through here.
 */
export async function consentReference(userId: string, sessionId: string, scopes: string[] = []) {
	const signedInAt = await verifiedSession(userId, sessionId)
	const ctx = await getCurrentAuthContext()
	const query = new URLSearchParams(
		typeof ctx.body?.oauth_query === "string" ? ctx.body.oauth_query : "",
	)
	const clientId = query.get("client_id") ?? ctx.query?.client_id
	if (typeof clientId !== "string" || !clientId) throw new APIError("BAD_REQUEST")
	if (!signedInRecently(signedInAt) && !(await hasGrant(userId, clientId)))
		throw reauthenticationRequired()
	await db
		.insert(oauthGrants)
		.values({ userId, clientId, generation: newId() })
		.onConflictDoNothing()
	const [grant] = await db
		.select()
		.from(oauthGrants)
		.where(and(eq(oauthGrants.userId, userId), eq(oauthGrants.clientId, clientId)))
	if (!grant) throw new APIError("FORBIDDEN")
	if (clientId === MOBILE_CLIENT_ID) {
		// The consent page carries the request signed in its body; authorize, in its query.
		const resource = ctx.body?.oauth_query ? query.getAll("resource") : ctx.query?.resource
		await keepAppConsent(userId, scopes, resource)
	}
	return grant.generation
}

/**
 * The app skips the consent screen (`skipConsent`), so the provider saves no consent for it. The
 * API asks for one (`liveTokenScopes`) and Settings lists it to disconnect: it is saved here, as
 * the consent screen would: each sign-in's request replaces what an earlier one allowed.
 */
async function keepAppConsent(userId: string, scopes: string[], resource: unknown) {
	const resources = (Array.isArray(resource) ? resource : [resource]).filter(
		(r): r is string => typeof r === "string",
	)
	const where = and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, MOBILE_CLIENT_ID))
	const [kept] = await db.select().from(oauthConsent).where(where)
	const now = new Date()
	if (!kept)
		return db.insert(oauthConsent).values({
			id: newId(),
			clientId: MOBILE_CLIENT_ID,
			userId,
			scopes,
			resources,
			createdAt: now,
			updatedAt: now,
		})
	await db.update(oauthConsent).set({ scopes, resources, updatedAt: now }).where(where)
}

export const credentialClaims: OAuthProviderExtension = {
	claims: {
		async accessToken({ user: owner, sessionId, client, referenceId, grantType }) {
			if (!owner) throw verificationRequired()
			// Opaque-token introspection has no session context. It still validates the
			// persisted reference below; every actual issuance must have a live session.
			if (grantType) await verifiedSession(owner.id, sessionId)
			if (!(await validGrant(owner.id, client.clientId, referenceId)))
				throw new APIError("BAD_REQUEST", {
					error: "invalid_grant",
					error_description: "Reconnect this app.",
				})
			return { klip_grant: referenceId }
		},
	},
}

export async function validGrant(userId: string, clientId: string, generation: unknown) {
	if (typeof generation !== "string") return false
	const [grant] = await db
		.select({ generation: oauthGrants.generation })
		.from(oauthGrants)
		.innerJoin(user, eq(user.id, oauthGrants.userId))
		.where(
			and(
				eq(oauthGrants.userId, userId),
				eq(oauthGrants.clientId, clientId),
				eq(user.emailVerified, true),
			),
		)
	return grant?.generation === generation
}
