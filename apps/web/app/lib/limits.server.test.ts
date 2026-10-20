import { accountBilling, db, eq, inArray, user as userTable } from "@klipstack/db"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { env } from "./env.server"
import {
	aiAllowance,
	checkFeeds,
	checkStorage,
	countMonthly,
	limitsFor,
	monthOf,
	planOf,
	usageOf,
} from "./limits.server"

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
			resetsAt: monthOf().resetsAt,
		})
		expect((await aiAllowance(userId)).used).toBe(before.used + 1)
	})
})

describe("plans", () => {
	const DAY = 24 * 60 * 60 * 1000
	const ago = (days: number) => new Date(Date.now() - days * DAY)
	const accounts: string[] = []
	/** An account made `days` ago, with an admin's `freeUntil` when given. */
	const account = async (
		days: number,
		{ role = "user", freeUntil }: { role?: "user" | "admin"; freeUntil?: Date } = {},
	) => {
		const id = `${userId}-plan-${accounts.length}`
		accounts.push(id)
		await db
			.insert(userTable)
			.values({ id, name: "Plan", email: `${id}@example.com`, role, createdAt: ago(days) })
		if (freeUntil) await db.insert(accountBilling).values({ userId: id, freeUntil })
		return id
	}
	const startsAt = (days: number | null) => {
		env.BILLING_STARTS_AT = days === null ? undefined : ago(days)
	}
	afterEach(() => startsAt(null))
	afterAll(async () => {
		await db.delete(userTable).where(inArray(userTable.id, accounts))
	})

	it("has nothing to do with billing while it is off or has not started", async () => {
		const id = await account(500)
		expect(await planOf(id)).toEqual({ state: "unbilled", until: null })
		startsAt(-3) // three days from now
		expect(await planOf(id)).toEqual({ state: "unbilled", until: null })
		expect(await limitsFor(id)).toEqual(await limitsFor(userId))
		expect((await limitsFor(id)).storage).toBe(env.LIMIT_STORAGE_MB * 1024 * 1024)
	})

	it("gives accounts older than billing a free year from its start, with the paid caps", async () => {
		const id = await account(500)
		startsAt(10)
		const start = env.BILLING_STARTS_AT!.getTime()
		expect(await planOf(id)).toEqual({ state: "free", until: new Date(start + 365 * DAY) })
		expect(await limitsFor(id)).toEqual({
			saves: 2000,
			storage: 2048 * 1024 * 1024,
			feeds: 500,
			editions: 30,
			shares: 500,
			ai: 300,
		})
		// The year is over: lapsed since it ended.
		startsAt(400)
		const lapsed = await planOf(id)
		expect(lapsed.state).toBe("lapsed")
		expect(Math.abs(lapsed.until!.getTime() - ago(35).getTime())).toBeLessThan(5_000)
	})

	it("gives newer accounts 30 days of trial with the trial's caps, then lapses them", async () => {
		startsAt(90)
		const inTrial = await account(30 - 1 / 24) // an hour of trial left
		const ended = await account(30 + 1 / 24) // an hour since it ended
		const trial = await planOf(inTrial)
		expect(trial.state).toBe("trial")
		expect(Math.abs(trial.until!.getTime() - (Date.now() + DAY / 24))).toBeLessThan(5_000)
		expect(await limitsFor(inTrial)).toEqual({
			saves: 300,
			storage: 500 * 1024 * 1024,
			feeds: 100,
			editions: 4,
			shares: 50,
			ai: 50,
		})
		const lapsed = await planOf(ended)
		expect(lapsed.state).toBe("lapsed")
		// It ended 30 days after the account was made: an hour ago.
		expect(Math.abs(lapsed.until!.getTime() - (Date.now() - DAY / 24))).toBeLessThan(5_000)
	})

	it("gives the trial to an account made at the very moment billing starts", async () => {
		startsAt(5)
		const id = await account(5)
		await db.update(userTable).set({ createdAt: env.BILLING_STARTS_AT }).where(eq(userTable.id, id))
		expect((await planOf(id)).state).toBe("trial")
	})

	it("lets an admin's date replace the free period, longer or shorter; admins never lapse", async () => {
		startsAt(90)
		const later = new Date(Date.now() + 200 * DAY)
		const given = await account(60, { freeUntil: later })
		expect(await planOf(given)).toEqual({ state: "free", until: later })
		// An older account whose founding year an admin cut short.
		const cut = await account(100, { freeUntil: ago(1) })
		expect((await planOf(cut)).state).toBe("lapsed")
		// And a trial cut short: it ended on the admin's date.
		const yesterday = ago(1)
		const cutTrial = await account(5, { freeUntil: yesterday })
		expect(await planOf(cutTrial)).toEqual({ state: "lapsed", until: yesterday })
		startsAt(800)
		const admin = await account(900, { role: "admin" })
		expect(await planOf(admin)).toEqual({ state: "free", until: null })
		expect((await limitsFor(admin)).ai).toBe(env.LIMIT_AI_PER_MONTH_ADMIN)
	})

	it("refuses a lapsed account anything a cap counts, and counts nothing", async () => {
		startsAt(90)
		const id = await account(60)
		for (const metric of ["saves", "editions", "shares", "ai"] as const)
			await expect(db.transaction((tx) => countMonthly(tx, id, metric))).rejects.toMatchObject({
				code: "subscription_required",
				status: 402,
				details: { endedAt: expect.any(String) },
			})
		await expect(checkStorage(id)).rejects.toMatchObject({ code: "subscription_required" })
		await expect(checkFeeds(id)).rejects.toMatchObject({ code: "subscription_required" })
		const usage = await usageOf(id)
		expect([usage.saves.used, usage.ai.used, usage.refused]).toEqual([0, 0, 0])
	})
})
