import {
	and,
	apiKeys,
	db,
	eq,
	newId,
	oauthAccessToken,
	oauthClient,
	oauthConsent,
	oauthGrants,
	oauthRefreshToken,
	user as userTable,
} from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Two triggers written by hand in migrations 0013 and 0014, which Drizzle's schema does not know
 * about: a later migration could drop them unnoticed. These check what they do.
 */
const stamp = Date.now()
const clients = [`test-trigger-a-${stamp}`, `test-trigger-b-${stamp}`]

beforeAll(async () => {
	for (const clientId of clients)
		await db
			.insert(oauthClient)
			.values({ id: newId(), clientId, name: clientId, redirectUris: ["http://127.0.0.1/cb"] })
})

afterAll(async () => {
	for (const clientId of clients)
		await db.delete(oauthClient).where(eq(oauthClient.clientId, clientId))
})

async function userWithCredentials(emailVerified: boolean) {
	const userId = `test-trigger-${newId()}`
	await db
		.insert(userTable)
		.values({ id: userId, name: "Trigger", email: `${userId}@example.com`, emailVerified })
	await db
		.insert(apiKeys)
		.values({ userId, name: "planted", prefix: "klip_test", keyHash: `hash-${newId()}` })
	for (const clientId of clients) {
		await db.insert(oauthConsent).values({ id: newId(), clientId, userId, scopes: ["openid"] })
		await db.insert(oauthGrants).values({ userId, clientId, generation: newId() })
		const refreshId = newId()
		await db
			.insert(oauthRefreshToken)
			.values({ id: refreshId, token: newId(), clientId, userId, scopes: ["openid"] })
		await db
			.insert(oauthAccessToken)
			.values({ id: newId(), token: newId(), clientId, userId, refreshId, scopes: ["openid"] })
	}
	return userId
}

async function credentials(userId: string) {
	const byUser = async (
		table:
			| typeof oauthConsent
			| typeof oauthGrants
			| typeof oauthRefreshToken
			| typeof oauthAccessToken,
	) =>
		(await db.select({ clientId: table.clientId }).from(table).where(eq(table.userId, userId)))
			.map((row) => row.clientId)
			.sort()
	const keys = await db.select().from(apiKeys).where(eq(apiKeys.userId, userId))
	return {
		liveKeys: keys.filter((key) => key.revokedAt === null).length,
		consent: await byUser(oauthConsent),
		grants: await byUser(oauthGrants),
		refresh: await byUser(oauthRefreshToken),
		access: await byUser(oauthAccessToken),
	}
}

describe("credential triggers", () => {
	it("a first verification ends everything granted before it (0013)", async () => {
		const userId = await userWithCredentials(false)
		await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.id, userId))
		expect(await credentials(userId)).toEqual({
			liveKeys: 0,
			consent: [],
			grants: [],
			refresh: [],
			access: [],
		})

		// Already verified: other updates leave new credentials alone.
		await db
			.insert(apiKeys)
			.values({ userId, name: "after", prefix: "klip_test", keyHash: `hash-${newId()}` })
		await db.update(userTable).set({ name: "Renamed" }).where(eq(userTable.id, userId))
		await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.id, userId))
		expect((await credentials(userId)).liveKeys).toBe(1)
		await db.delete(userTable).where(eq(userTable.id, userId))
	})

	it("deleting one app's consent ends that app's grant and tokens only (0014)", async () => {
		const userId = await userWithCredentials(true)
		await db
			.delete(oauthConsent)
			.where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clients[0]!)))
		const rest = [clients[1]]
		expect(await credentials(userId)).toEqual({
			liveKeys: 1,
			consent: rest,
			grants: rest,
			refresh: rest,
			access: rest,
		})
		await db.delete(userTable).where(eq(userTable.id, userId))
	})
})
