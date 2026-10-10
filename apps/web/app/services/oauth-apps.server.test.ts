import {
	db,
	eq,
	newId,
	oauthClient,
	oauthConsent,
	oauthGrants,
	user as userTable,
} from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { validGrant } from "~/lib/credential-policy.server"
import {
	consentedScopes,
	disconnectApp,
	effectiveScopes,
	listConnectedApps,
} from "./oauth-apps.server"

const userId = `test-consent-${Date.now()}`
const clientId = `test-client-${Date.now()}`

beforeAll(async () => {
	await db
		.insert(userTable)
		.values({ id: userId, name: "Consent", email: `${userId}@example.com`, emailVerified: true })
	await db.insert(oauthClient).values({
		id: newId(),
		clientId,
		name: "Test client",
		redirectUris: ["http://127.0.0.1/callback"],
	})
})

afterAll(async () => {
	await db.delete(oauthClient).where(eq(oauthClient.clientId, clientId))
	await db.delete(userTable).where(eq(userTable.id, userId))
})

const consent = (scopes: string[], updatedAt: Date | null) => ({
	id: newId(),
	clientId,
	userId,
	scopes,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	updatedAt,
})

describe("consentedScopes", () => {
	it("is null without a consent, and reads the newest one when there are several", async () => {
		expect(await consentedScopes(userId, clientId)).toBeNull()
		await db
			.insert(oauthConsent)
			.values([
				consent(["library:read"], new Date("2026-09-01T00:00:00Z")),
				consent(["library:read", "library:write"], new Date("2026-09-02T00:00:00Z")),
				consent(["openid"], null),
			])
		expect(await consentedScopes(userId, clientId)).toEqual(["library:read", "library:write"])
		await db
			.insert(oauthConsent)
			.values(consent(["library:read"], new Date("2026-09-03T00:00:00Z")))
		expect(await consentedScopes(userId, clientId)).toEqual(["library:read"])
	})

	it("lists an app once, and disconnecting removes all of its consent rows", async () => {
		const apps = await listConnectedApps(userId)
		expect(apps.map((a) => a.clientId)).toEqual([clientId])
		expect(apps[0]?.scopes).toEqual(["library:read"])
		const [oldest] = await db
			.select({ id: oauthConsent.id })
			.from(oauthConsent)
			.where(eq(oauthConsent.userId, userId))
			.limit(1)
		await disconnectApp("someone-else", oldest!.id)
		expect(await consentedScopes(userId, clientId)).not.toBeNull()
		await disconnectApp(userId, oldest!.id)
		expect(await consentedScopes(userId, clientId)).toBeNull()
		expect(await listConnectedApps(userId)).toEqual([])
	})

	it("limits a token to what the consent still allows", () => {
		expect(effectiveScopes("openid library:read library:write", ["library:read"])).toEqual([
			"library:read",
		])
		expect(effectiveScopes(undefined, ["library:read"])).toEqual([])
		expect(effectiveScopes("library:read  library:write", ["library:write"])).toEqual([
			"library:write",
		])
	})
	it("does not revive an old grant when reconnecting in the same second", async () => {
		const old = newId()
		await db.insert(oauthGrants).values({ userId, clientId, generation: old })
		const row = consent(["library:read"], new Date())
		await db.insert(oauthConsent).values(row)
		expect(await validGrant(userId, clientId, old)).toBe(true)
		await disconnectApp(userId, row.id)
		const fresh = newId()
		await db.insert(oauthGrants).values({ userId, clientId, generation: fresh })
		await db.insert(oauthConsent).values(consent(["library:read"], new Date()))
		expect(await validGrant(userId, clientId, old)).toBe(false)
		expect(await validGrant(userId, clientId, undefined)).toBe(false)
		expect(await validGrant(userId, clientId, fresh)).toBe(true)
	})
})
