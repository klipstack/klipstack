import { adminAuditEvents, db, eq } from "@klipstack/db"
import { afterAll, afterEach, describe, expect, it } from "vitest"
import { authorizeAdmin } from "~/lib/admin.server"
import { env } from "~/lib/env.server"
import { planOf } from "~/lib/limits.server"
import { adminFixtures, thrownBy } from "~/test/admin-fixtures"
import { setFreeUntil } from "./admin-billing.server"

const fx = adminFixtures("admin-billing")
afterAll(fx.cleanup)
afterEach(() => {
	env.BILLING_STARTS_AT = undefined
})

const DAY = 24 * 60 * 60 * 1000

async function setup() {
	const admin = await fx.account({ role: "admin" })
	const reader = await fx.account()
	return { reader, ctx: await authorizeAdmin(await admin.session()) }
}

const events = (id: string) =>
	db
		.select({ action: adminAuditEvents.action, metadata: adminAuditEvents.metadata })
		.from(adminAuditEvents)
		.where(eq(adminAuditEvents.targetId, id))
		.orderBy(adminAuditEvents.createdAt)

describe("setFreeUntil", () => {
	it("gives an account the paid plan free until a date, and takes it back", async () => {
		const { reader, ctx } = await setup()
		// Billing started a month before the account: it is in its trial.
		env.BILLING_STARTS_AT = new Date(Date.now() - 30 * DAY)
		expect((await planOf(reader.id)).state).toBe("trial")

		const until = new Date("2099-01-31T00:00:00Z")
		expect(await setFreeUntil(ctx, reader.id, until)).toEqual({ changed: true })
		expect(await planOf(reader.id)).toEqual({ state: "free", until })
		// The same date again changes nothing and records nothing.
		expect(await setFreeUntil(ctx, reader.id, until)).toEqual({ changed: false })

		expect(await setFreeUntil(ctx, reader.id, null)).toEqual({ changed: true })
		expect((await planOf(reader.id)).state).toBe("trial")
		expect(await events(reader.id)).toEqual([
			{ action: "billing.free_until", metadata: { freeUntil: until.toISOString() } },
			{ action: "billing.free_until", metadata: { freeUntil: null } },
		])
	})

	it("answers 404 for an account that does not exist", async () => {
		const { ctx } = await setup()
		const error = await thrownBy(() => setFreeUntil(ctx, "no-such-account", new Date()))
		expect(error).toMatchObject({ status: 404, code: "not_found" })
	})
})
