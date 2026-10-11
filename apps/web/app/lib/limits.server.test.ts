import { db, eq, user as userTable } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "./env.server"
import { aiAllowance, countMonthly, limitsFor, monthOf, usageOf } from "./limits.server"

const userId = `test-limits-${Date.now()}`

beforeAll(async () => {
	await db.insert(userTable).values({ id: userId, name: "Limits", email: `${userId}@example.com` })
})

afterAll(async () => {
	await db.delete(userTable).where(eq(userTable.id, userId))
})

describe("monthOf", () => {
	it("starts over on the 1st, UTC, the year's turn included", () => {
		expect(monthOf(new Date("2026-12-31T23:59:59Z"))).toEqual({
			month: "2026-12-01",
			resetsAt: new Date("2027-01-01T00:00:00Z"),
		})
		expect(monthOf(new Date("2027-01-01T00:00:00Z")).month).toBe("2027-01-01")
	})
})

describe("countMonthly", () => {
	it("lets only one of two at once take the last one; a refusal counts only as a refusal", async () => {
		const before = env.LIMIT_EDITIONS_PER_MONTH
		env.LIMIT_EDITIONS_PER_MONTH = 1
		try {
			const results = await Promise.allSettled(
				[1, 2].map(() => db.transaction((tx) => countMonthly(tx, userId, "editions"))),
			)
			expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"])
			const refused = results.find((r) => r.status === "rejected")
			expect(refused?.reason).toMatchObject({
				code: "limit_reached",
				details: { limit: "editions" },
			})
			const usage = await usageOf(userId)
			expect(usage.editions).toEqual({ used: 1, max: 1 })
			// The refused work rolled back; the refusal stays counted, for admins.
			expect(usage.refused).toBe(1)
		} finally {
			env.LIMIT_EDITIONS_PER_MONTH = before
		}
	})
})

describe("limitsFor", () => {
	it("gives admins their own AI cap, and everyone else the default one", async () => {
		const adminId = `${userId}-admin`
		await db
			.insert(userTable)
			.values({ id: adminId, name: "Admin", email: `${adminId}@example.com`, role: "admin" })
		try {
			expect((await limitsFor(userId)).ai).toBe(env.LIMIT_AI_PER_MONTH)
			expect((await limitsFor(adminId)).ai).toBe(env.LIMIT_AI_PER_MONTH_ADMIN)
			expect(env.LIMIT_AI_PER_MONTH_ADMIN).toBeGreaterThan(env.LIMIT_AI_PER_MONTH)
			// Only the AI cap differs.
			expect({ ...(await limitsFor(adminId)), ai: 0 }).toEqual({
				...(await limitsFor(userId)),
				ai: 0,
			})
		} finally {
			await db.delete(userTable).where(eq(userTable.id, adminId))
		}
	})
})

describe("aiAllowance", () => {
	it("is this month's AI questions against the account's cap, and when they start over", async () => {
		const before = await aiAllowance(userId)
		expect(before).toEqual({
			used: expect.any(Number),
			max: env.LIMIT_AI_PER_MONTH,
			resetsAt: monthOf().resetsAt.toISOString(),
		})
		expect(await db.transaction((tx) => countMonthly(tx, userId, "ai"))).toEqual({
			used: before.used + 1,
			max: env.LIMIT_AI_PER_MONTH,
		})
		expect((await aiAllowance(userId)).used).toBe(before.used + 1)
	})
})
