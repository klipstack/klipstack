import { randomUUID } from "node:crypto"
import {
	adminAuditEvents,
	and,
	assets,
	db,
	documents,
	eq,
	newId,
	session,
	twoFactor,
	user,
} from "@klipstack/db"
import { getStorage } from "@klipstack/storage"
import { afterAll, describe, expect, it } from "vitest"
import { adminFixtures } from "~/test/admin-fixtures"
import { deleteAccountAsOperator, resetTwoFactorAsOperator } from "./admin-accounts.server"

const fx = adminFixtures("admin-accounts")
afterAll(fx.cleanup)

const exists = async (id: string) =>
	(await db.select({ id: user.id }).from(user).where(eq(user.id, id))).length === 1

describe("deleteAccountAsOperator", () => {
	it("refuses without a reason, a matching confirmation, or for an admin, and deletes nothing", async () => {
		const reader = await fx.account()
		const admin = await fx.account({ role: "admin" })
		for (const [target, input, code] of [
			[{ email: reader.email }, { confirm: reader.email, reason: " " }, "invalid_request"],
			[
				{ email: reader.email },
				{ confirm: "someone@else.test", reason: "Spam" },
				"invalid_request",
			],
			[{ userId: admin.id }, { confirm: admin.email, reason: "Spam" }, "invalid_request"],
			[
				{ email: "nobody@nowhere.test" },
				{ confirm: "nobody@nowhere.test", reason: "Spam" },
				"not_found",
			],
		] as const)
			await expect(deleteAccountAsOperator(target, input)).rejects.toMatchObject({ code })
		expect(await exists(reader.id)).toBe(true)
		expect(await exists(admin.id)).toBe(true)
	})

	it("deletes the account, its rows and its images, and records why", async () => {
		const reader = await fx.account()
		await db
			.insert(documents)
			.values({ userId: reader.id, sourceUrl: "https://a.test/1", urlHash: randomUUID() })
		const key = `test/${reader.id}/image.webp`
		await getStorage().put(key, Buffer.from("image"), "image/webp")
		await db.insert(assets).values({
			userId: reader.id,
			sha256: randomUUID(),
			storageKey: key,
			contentType: "image/webp",
			bytes: 5,
		})

		expect(
			await deleteAccountAsOperator(
				{ email: ` ${reader.email.toUpperCase()} ` },
				{ confirm: reader.email, reason: "Phishing editions, removed twice" },
			),
		).toEqual({ userId: reader.id, email: reader.email })
		expect(await exists(reader.id)).toBe(false)
		expect(await db.select().from(documents).where(eq(documents.userId, reader.id))).toEqual([])
		expect(await getStorage().get(key)).toBeNull()
		const [event] = await db
			.select()
			.from(adminAuditEvents)
			.where(eq(adminAuditEvents.targetId, reader.id))
		expect(event).toMatchObject({
			actorKind: "operator-cli",
			actorUserId: null,
			action: "account.delete",
			targetKind: "user",
			metadata: { reason: "Phishing editions, removed twice" },
		})
	})
})

describe("resetTwoFactorAsOperator", () => {
	const events = (id: string) =>
		db
			.select()
			.from(adminAuditEvents)
			.where(
				and(
					eq(adminAuditEvents.targetId, id),
					eq(adminAuditEvents.action, "account.reset_two_factor"),
				),
			)

	it("removes the authenticator and backup codes, ends every session, and records why", async () => {
		const reader = await fx.account()
		await db.insert(twoFactor).values({
			id: newId(),
			userId: reader.id,
			secret: "sealed-secret",
			backupCodes: "sealed-codes",
		})
		await db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, reader.id))
		expect(await reader.session()).not.toBeNull()

		await expect(
			resetTwoFactorAsOperator({ userId: reader.id }, { reason: " " }),
		).rejects.toMatchObject({ code: "invalid_request" })
		const result = await resetTwoFactorAsOperator(
			{ email: reader.email.toUpperCase() },
			{ reason: "Lost phone and codes; confirmed by reply" },
		)
		expect(result).toMatchObject({ userId: reader.id, changed: true })
		expect(result.sessionsEnded).toBeGreaterThanOrEqual(1)
		expect(await db.select().from(twoFactor).where(eq(twoFactor.userId, reader.id))).toEqual([])
		const [row] = await db.select().from(user).where(eq(user.id, reader.id))
		expect(row!.twoFactorEnabled).toBe(false)
		expect(await db.select().from(session).where(eq(session.userId, reader.id))).toEqual([])
		expect(await events(reader.id)).toMatchObject([
			{
				actorKind: "operator-cli",
				metadata: { reason: "Lost phone and codes; confirmed by reply" },
			},
		])
	})

	it("changes nothing, and records nothing, for an account without it", async () => {
		const reader = await fx.account()
		expect(
			await resetTwoFactorAsOperator({ userId: reader.id }, { reason: "Asked by mistake" }),
		).toEqual({ userId: reader.id, changed: false, sessionsEnded: 0 })
		expect(await reader.session()).not.toBeNull()
		expect(await events(reader.id)).toEqual([])
	})
})
