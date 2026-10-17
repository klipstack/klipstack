import { randomUUID } from "node:crypto"
import { MOBILE_CLIENT_ID } from "@klipstack/api-contract/auth"
import { account, db, eq, user, userFeatures } from "@klipstack/db"
import { hashPassword } from "better-auth/crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { auth } from "~/lib/auth.server"
import { env } from "~/lib/env.server"
import { request, serveKeySet } from "~/test/api-harness"
import { appToken } from "./app-token"

const id = `test-app-token-${randomUUID()}`
const email = `${id}@example.com`
const password = "app-token-test-password"
const MISSING = "00000000-0000-4000-8000-000000000000"

/** Only the app's own tokens reach the article's AI (IN_APP_AI_CLIENTS): others get 403. */
const articleAi = (token: string | undefined) =>
	request(`/api/v1/articles/${MISSING}/ai`, { token }).then((r) => r.status)

beforeAll(async () => {
	serveKeySet()
	await db.insert(user).values({ id, name: "App", email, emailVerified: true })
	await db.insert(account).values({
		id: randomUUID(),
		accountId: id,
		userId: id,
		providerId: "credential",
		password: await hashPassword(password),
	})
	await db.insert(userFeatures).values({ userId: id, feature: "ai" })
})
afterAll(async () => {
	await db.delete(user).where(eq(user.id, id))
})

describe("appToken", () => {
	it("signs the iPhone app in: a token the app-only endpoints answer, and a refresh token", async () => {
		const issued = await appToken(email, password)
		const me = await request("/api/v1/me", { token: issued.accessToken })
		expect(await me.json()).toMatchObject({ email, client: { id: MOBILE_CLIENT_ID } })
		expect(await articleAi(issued.accessToken)).toBe(404)

		// What the app does at its first request: refresh.
		const refreshed = await auth.handler(
			new Request(`${env.APP_URL}/api/auth/oauth2/token`, {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					grant_type: "refresh_token",
					refresh_token: issued.refreshToken,
					client_id: MOBILE_CLIENT_ID,
					resource: `${env.APP_URL}/api`,
				}),
			}),
		)
		const body = (await refreshed.json()) as { access_token?: string }
		expect(refreshed.status, JSON.stringify(body)).toBe(200)
		const again = await request("/api/v1/me", { token: body.access_token })
		expect(await again.json()).toMatchObject({ email, client: { id: MOBILE_CLIENT_ID } })
		expect(await articleAi(body.access_token)).toBe(404)
	})

	it("refuses a wrong password", async () => {
		await expect(appToken(email, "not-the-password")).rejects.toThrow(/Signing in failed \(401\)/)
	})
})
