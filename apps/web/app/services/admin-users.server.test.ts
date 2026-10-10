import { randomUUID } from "node:crypto"
import { db, documents, eq, user } from "@klipstack/db"
import { afterAll, describe, expect, it } from "vitest"
import { authorizeAdmin } from "~/lib/admin.server"
import { adminFixtures } from "~/test/admin-fixtures"
import { escapeLike, getUserDetail, listUsers } from "./admin-users.server"

const fx = adminFixtures("admin-users")
afterAll(fx.cleanup)

describe("account search", () => {
	it("escapes wildcards, so the search is literal", async () => {
		expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\")
		const admin = await fx.account({ role: "admin" })
		const ctx = await authorizeAdmin(await admin.session())
		const target = await fx.account()
		const marker = `pct%${randomUUID().slice(0, 8)}`
		await db.update(user).set({ name: marker }).where(eq(user.id, target.id))
		expect((await listUsers(ctx, { query: marker })).users.map((u) => u.id)).toEqual([target.id])
		// As a pattern, "%" alone would match every account.
		expect((await listUsers(ctx, { query: "%" })).users.map((u) => u.id)).toEqual([target.id])
		expect((await listUsers(ctx, { query: target.email.toUpperCase() })).users).toHaveLength(1)
		expect((await listUsers(ctx, { query: "x".repeat(500) })).users).toEqual([])
	})

	it("returns account metadata and aggregate counts only", async () => {
		const admin = await fx.account({ role: "admin" })
		const ctx = await authorizeAdmin(await admin.session())
		const target = await fx.account()
		await db.insert(documents).values([
			{
				userId: target.id,
				sourceUrl: "https://articles.test/1",
				urlHash: randomUUID(),
				title: "Secret",
			},
			{
				userId: target.id,
				sourceUrl: "https://articles.test/2",
				urlHash: randomUUID(),
				deletedAt: new Date(),
			},
		])
		const detail = await getUserDetail(ctx, target.id)
		expect(detail).toEqual({
			id: target.id,
			name: expect.any(String),
			email: target.email,
			role: "user",
			emailVerified: true,
			createdAt: expect.any(String),
			invitedBy: null,
			articles: 1,
			highlights: 0,
			activeSessions: 1,
		})
		expect(JSON.stringify(detail)).not.toMatch(/Secret|password|token|articles\.test/)
		const [summary] = (await listUsers(ctx, { query: target.email })).users
		expect(Object.keys(summary!).sort()).toEqual(
			["createdAt", "email", "emailVerified", "id", "name", "role"].sort(),
		)
		expect(await getUserDetail(ctx, "no-such-user")).toBeNull()
	})

	it("refuses a context it did not issue", async () => {
		const forged = { userId: "x", sessionId: "y", signedInAt: new Date(), correlationId: "z" }
		await expect(listUsers(forged, {})).rejects.toThrow()
	})
})
