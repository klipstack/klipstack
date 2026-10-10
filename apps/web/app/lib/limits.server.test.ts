import { db, eq, user as userTable } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "./env.server"
import { countMonthly, monthOf, usageOf } from "./limits.server"

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
