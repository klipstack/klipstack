import { db, eq, user, userFeatures } from "@klipstack/db"
import { afterAll, describe, expect, it } from "vitest"
import { authorizeAdmin } from "~/lib/admin.server"
import { AppError } from "~/lib/app-error"
import { listFeatures } from "~/lib/features.server"
import { adminFixtures, thrownBy } from "~/test/admin-fixtures"
import { setFeature } from "./admin-features.server"

const fx = adminFixtures("admin-features")
afterAll(fx.cleanup)

/**
 * These cover what the mechanism does with a flag the code does not know, such as editions,
 * which reached everyone.
 */
const RETIRED = "editions" as never

async function setup() {
	const admin = await fx.account({ role: "admin" })
	const reader = await fx.account()
	return { reader, ctx: await authorizeAdmin(await admin.session()) }
}

describe("feature flags", () => {
	it("ignore rows of flags the code no longer knows", async () => {
		const { reader } = await setup()
		await db.insert(userFeatures).values({ userId: reader.id, feature: RETIRED })
		// The ones a new account starts with, and not the retired one.
		expect(await listFeatures(reader.id)).toEqual(["ai", "topics"])
	})

	it("answer 404 for an account that does not exist", async () => {
		const { ctx } = await setup()
		const error = await thrownBy(() => setFeature(ctx, "no-such-account", RETIRED, true))
		expect(error).toBeInstanceOf(AppError)
		expect(error).toMatchObject({ status: 404, code: "not_found" })
	})

	it("go with the account when it is deleted", async () => {
		const { reader } = await setup()
		await db.insert(userFeatures).values({ userId: reader.id, feature: RETIRED })
		await db.delete(user).where(eq(user.id, reader.id))
		const rows = await db.select().from(userFeatures).where(eq(userFeatures.userId, reader.id))
		expect(rows).toEqual([])
	})
})
