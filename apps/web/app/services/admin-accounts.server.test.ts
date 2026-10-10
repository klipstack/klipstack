import { randomUUID } from "node:crypto"
import { adminAuditEvents, assets, db, documents, eq, user } from "@klipstack/db"
import { getStorage } from "@klipstack/storage"
import { afterAll, describe, expect, it } from "vitest"
import { adminFixtures } from "~/test/admin-fixtures"
import { deleteAccountAsOperator } from "./admin-accounts.server"

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
