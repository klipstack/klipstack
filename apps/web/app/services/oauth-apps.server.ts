import {
	and,
	db,
	desc,
	eq,
	oauthAccessToken,
	oauthClient,
	oauthConsent,
	oauthGrants,
	oauthRefreshToken,
	sql,
} from "@klipstack/db"
import { httpsHost } from "~/lib/oauth.server"

/**
 * Apps the user granted access to through the OAuth consent screen, newest first. An app appears
 * once, even if a race in the provider left it several consent rows.
 */
export async function listConnectedApps(userId: string) {
	const rows = await db
		.selectDistinctOn([oauthConsent.clientId], {
			id: oauthConsent.id,
			clientId: oauthConsent.clientId,
			name: oauthClient.name,
			scopes: oauthConsent.scopes,
			createdAt: oauthConsent.createdAt,
		})
		.from(oauthConsent)
		.innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
		.where(eq(oauthConsent.userId, userId))
		.orderBy(
			oauthConsent.clientId,
			sql`${oauthConsent.updatedAt} desc nulls last`,
			sql`${oauthConsent.createdAt} desc nulls last`,
			desc(oauthConsent.id),
		)
	return rows
		.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
		.map((row) => ({ ...row, host: httpsHost(row.clientId) }))
}

/**
 * Removes the app's consent (every row of it) and every stored token the app holds for this user,
 * so it must ask again. JWT access tokens are not stored; /mcp and /api check the consent on every
 * request instead. `consentId` is any of the app's consent rows, as Settings lists them. False when
 * the user has no such consent.
 */
export async function disconnectApp(userId: string, consentId: string): Promise<boolean> {
	return db.transaction(async (tx) => {
		const [consent] = await tx
			.select({ clientId: oauthConsent.clientId })
			.from(oauthConsent)
			.where(and(eq(oauthConsent.id, consentId), eq(oauthConsent.userId, userId)))
		if (!consent) return false
		await tx
			.delete(oauthGrants)
			.where(and(eq(oauthGrants.userId, userId), eq(oauthGrants.clientId, consent.clientId)))
		const byApp = (t: typeof oauthConsent | typeof oauthAccessToken | typeof oauthRefreshToken) =>
			and(eq(t.userId, userId), eq(t.clientId, consent.clientId))
		await tx.delete(oauthConsent).where(byApp(oauthConsent))
		await tx.delete(oauthAccessToken).where(byApp(oauthAccessToken))
		await tx.delete(oauthRefreshToken).where(byApp(oauthRefreshToken))
		return true
	})
}

/**
 * The scopes the user currently allows this app, or null when it was disconnected in Settings.
 * The latest consent wins: signing in again with write access cleared takes it away from the
 * app's older tokens too, whose scope claims cannot change.
 */
export async function consentedScopes(userId: string, clientId: string): Promise<string[] | null> {
	// Nothing stops two consent rows for one app (a race in the provider): the newest one counts.
	const [row] = await db
		.select({ scopes: oauthConsent.scopes })
		.from(oauthConsent)
		.where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)))
		.orderBy(
			sql`${oauthConsent.updatedAt} desc nulls last`,
			sql`${oauthConsent.createdAt} desc nulls last`,
			desc(oauthConsent.id),
		)
		.limit(1)
	return row?.scopes ?? null
}

/** What a token may do now: the scopes it was granted that the user still allows. */
export function effectiveScopes(tokenScope: unknown, consented: readonly string[]): string[] {
	const granted = typeof tokenScope === "string" ? tokenScope.split(" ").filter(Boolean) : []
	return granted.filter((scope) => consented.includes(scope))
}
