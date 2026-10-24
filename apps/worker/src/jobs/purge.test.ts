import { randomUUID } from "node:crypto"
import { db, eq, inArray, pool, session, user, verification } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { purgeExpiredSignIns } from "./purge"

const owner = `purge-signins-${randomUUID()}`
const marker = `purge-signins-${randomUUID()}`
const MINUTE = 60_000
const at = (ms: number) => new Date(Date.now() + ms)

beforeAll(async () => {
	await db.insert(user).values({ id: owner, name: "Purge", email: `${owner}@example.com` })
})
afterAll(async () => {
	await db.delete(verification).where(eq(verification.identifier, marker))
	await db.delete(user).where(eq(user.id, owner))
	await pool.end()
})

describe("purgeExpiredSignIns", () => {
	// In one transaction: Better Auth deletes every expired token whenever it looks one up, so the
	// web tests sharing this database would otherwise take ours before the purge counts it.
	it("removes expired sessions and one-time tokens, and keeps the live ones", () =>
		db.transaction(async (tx) => {
			const [expired, live] = [randomUUID(), randomUUID()]
			await tx.insert(session).values([
				{
					id: expired,
					token: randomUUID(),
					userId: owner,
					expiresAt: at(-MINUTE),
					ipAddress: "203.0.113.7",
					userAgent: "Old browser",
				},
				{ id: live, token: randomUUID(), userId: owner, expiresAt: at(30 * 24 * 60 * MINUTE) },
			])
			const [usedUp, pending] = [randomUUID(), randomUUID()]
			await tx.insert(verification).values([
				{ id: usedUp, identifier: marker, value: "old", expiresAt: at(-MINUTE) },
				{ id: pending, identifier: marker, value: "new", expiresAt: at(5 * MINUTE) },
			])

			const removed = await purgeExpiredSignIns(tx)

			expect(removed.sessions).toBeGreaterThanOrEqual(1)
			expect(removed.verifications).toBeGreaterThanOrEqual(1)
			const sessions = await tx
				.select({ id: session.id })
				.from(session)
				.where(inArray(session.id, [expired, live]))
			expect(sessions.map((s) => s.id)).toEqual([live])
			const tokens = await tx
				.select({ id: verification.id })
				.from(verification)
				.where(eq(verification.identifier, marker))
			expect(tokens.map((v) => v.id)).toEqual([pending])
		}))
})
