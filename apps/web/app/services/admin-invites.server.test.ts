import { randomUUID } from "node:crypto"
import { adminAuditEvents, and, db, eq, gt, invites, isNull, or, sql } from "@klipstack/db"
import { afterAll, describe, expect, it, vi } from "vitest"
import { authorizeAdmin } from "~/lib/admin.server"
import { AppError } from "~/lib/app-error"
import { auth } from "~/lib/auth.server"
import { consumeInvite, findUsableInvite, signupWithInvite } from "~/lib/invites.server"
import { adminFixtures, thrownBy } from "~/test/admin-fixtures"

const audit = vi.hoisted(() => ({ fail: false }))
vi.mock("./admin-audit.server", async (original) => {
	const real = await original<typeof import("./admin-audit.server")>()
	return {
		...real,
		recordAudit: (...args: Parameters<typeof real.recordAudit>) => {
			if (audit.fail) throw new Error("audit unavailable")
			return real.recordAudit(...args)
		},
	}
})

const { createAdminInvite, listInvites, revokeInvite, REVOKED_EXPIRY_MARGIN_MINUTES } =
	await import("./admin-invites.server")

const fx = adminFixtures("admin-invites")
const made: string[] = []
afterAll(async () => {
	for (const id of made) await db.delete(invites).where(eq(invites.id, id))
	await fx.cleanup()
})

async function adminCtx() {
	const admin = await fx.account({ role: "admin" })
	return { admin, ctx: await authorizeAdmin(await admin.session()) }
}

async function invite(
	ctx: Awaited<ReturnType<typeof adminCtx>>["ctx"],
	expiry: "7d" | "never" = "7d",
) {
	const created = await createAdminInvite(ctx, { note: "For a friend", expiry })
	made.push(created.id)
	return created
}

const row = async (id: string) => (await db.select().from(invites).where(eq(invites.id, id)))[0]!

/** The signup check as it was before `revoked_at` existed (a rolled-back application). */
async function usableByLegacyCode(code: string) {
	const rows = await db
		.select()
		.from(invites)
		.where(
			and(
				eq(invites.code, code),
				isNull(invites.usedBy),
				isNull(invites.usedAt),
				or(isNull(invites.expiresAt), gt(invites.expiresAt, new Date())),
			),
		)
	return rows.length > 0
}

const signup = (code: string) =>
	signupWithInvite(code, () =>
		auth.api.signUpEmail({
			headers: fx.signedHeaders,
			body: {
				name: "Invitee",
				email: `invitee-${randomUUID()}@example.com`,
				password: "password123",
			},
			returnHeaders: true,
		}),
	)

describe("creating invites", () => {
	it("sets the creator from the session, a database-clock expiry, and an audit event without the code", async () => {
		const { admin, ctx } = await adminCtx()
		const created = await invite(ctx)
		const stored = await row(created.id)
		expect(stored).toMatchObject({ createdBy: admin.id, note: "For a friend", revokedAt: null })
		const days = (stored.expiresAt!.getTime() - stored.createdAt.getTime()) / 86_400_000
		expect(days).toBeCloseTo(7, 3)
		const events = await db
			.select()
			.from(adminAuditEvents)
			.where(eq(adminAuditEvents.targetId, created.id))
		expect(events).toHaveLength(1)
		expect(events[0]).toMatchObject({
			actorKind: "user",
			actorUserId: admin.id,
			action: "invite.create",
			correlationId: ctx.correlationId,
			metadata: { inviteId: created.id, expiry: "7d" },
		})
		expect(JSON.stringify(events[0])).not.toContain(created.code)
		expect(JSON.stringify(events[0])).not.toContain("For a friend")
	})

	it("creates nothing when the audit event cannot be written", async () => {
		const { admin, ctx } = await adminCtx()
		audit.fail = true
		try {
			await expect(createAdminInvite(ctx, { expiry: "never" })).rejects.toThrow("audit unavailable")
		} finally {
			audit.fail = false
		}
		expect(await db.select().from(invites).where(eq(invites.createdBy, admin.id))).toHaveLength(0)
	})

	it("lists invites by status through an explicit shape", async () => {
		const { ctx } = await adminCtx()
		const created = await invite(ctx)
		const active = await listInvites(ctx, { status: "active" })
		const mine = active.invites.find((i) => i.id === created.id)!
		expect(Object.keys(mine).sort()).toEqual(
			[
				"code",
				"createdAt",
				"createdBy",
				"expiresAt",
				"id",
				"note",
				"revokedAt",
				"status",
				"usedAt",
				"usedBy",
			].sort(),
		)
		expect(mine.status).toBe("active")
		await revokeInvite(ctx, created.id)
		const revoked = await listInvites(ctx, { status: "revoked" })
		expect(revoked.invites.map((i) => i.id)).toContain(created.id)
		const stillActive = await listInvites(ctx, { status: "active" })
		expect(stillActive.invites.map((i) => i.id)).not.toContain(created.id)
	})
})

describe("revoking invites", () => {
	it.each(["7d", "never"] as const)(
		"makes a %s invite unusable for current and pre-admin signup code",
		async (expiry) => {
			const { ctx } = await adminCtx()
			const created = await invite(ctx, expiry)
			expect(await usableByLegacyCode(created.code)).toBe(true)
			expect(await revokeInvite(ctx, created.id)).toEqual({ changed: true })
			const stored = await row(created.id)
			expect(stored.revokedAt).not.toBeNull()
			// Both are the database's clock: the cutoff sits a margin before the revocation, so
			// code comparing it with an application clock that runs behind still sees it expired.
			expect(stored.revokedAt!.getTime() - stored.expiresAt!.getTime()).toBe(
				REVOKED_EXPIRY_MARGIN_MINUTES * 60_000,
			)
			expect(await usableByLegacyCode(created.code)).toBe(false)
			await expect(signup(created.code)).rejects.toMatchObject({ statusCode: 403 })
		},
	)

	it("refuses a revoked invite whose expiry is still ahead (clocks that disagree)", async () => {
		const { ctx } = await adminCtx()
		const created = await invite(ctx)
		await revokeInvite(ctx, created.id)
		// What a slow application clock, or a hand-edited row, would look like to the signup check.
		await db.execute(
			sql`update invites set expires_at = now() + interval '1 day' where id = ${created.id}::uuid`,
		)
		expect(await findUsableInvite(created.code)).toBeNull()
		await expect(signup(created.code)).rejects.toMatchObject({ statusCode: 403 })
		// Consumption refuses on its own too, rather than updating nothing and returning.
		await expect(consumeInvite(created.code, ctx.userId)).rejects.toMatchObject({ statusCode: 403 })
		expect((await row(created.id)).usedBy).toBeNull()
	})

	it("is harmless to repeat, never extends an expiry, and writes one event", async () => {
		const { ctx } = await adminCtx()
		const created = await invite(ctx)
		await db.execute(
			sql`update invites set expires_at = now() - interval '2 days' where id = ${created.id}::uuid`,
		)
		const expired = (await row(created.id)).expiresAt!.getTime()
		expect(await revokeInvite(ctx, created.id)).toEqual({ changed: true })
		expect(await revokeInvite(ctx, created.id)).toEqual({ changed: false })
		expect((await row(created.id)).expiresAt!.getTime()).toBe(expired)
		const events = await db
			.select()
			.from(adminAuditEvents)
			.where(
				and(
					eq(adminAuditEvents.targetId, created.id),
					eq(adminAuditEvents.action, "invite.revoke"),
				),
			)
		expect(events).toHaveLength(1)
	})

	it("refuses used invites (409) and unknown ones (404), and rolls back without its audit event", async () => {
		const { ctx } = await adminCtx()
		const used = await invite(ctx)
		await signup(used.code).then((r) => db.execute(sql`select ${r.response.user.id}`))
		expect(await thrownBy(() => revokeInvite(ctx, used.id))).toMatchObject({ status: 409 })
		expect(await thrownBy(() => revokeInvite(ctx, randomUUID()))).toMatchObject({ status: 404 })

		const kept = await invite(ctx)
		audit.fail = true
		try {
			await expect(revokeInvite(ctx, kept.id)).rejects.toThrow("audit unavailable")
		} finally {
			audit.fail = false
		}
		expect((await row(kept.id)).revokedAt).toBeNull()
		await db.execute(
			sql`delete from "user" where id in (select used_by from invites where id = ${used.id}::uuid)`,
		)
		// A consumed invite stays consumed after its account is gone.
		expect((await row(used.id)).usedAt).not.toBeNull()
		expect(await thrownBy(() => revokeInvite(ctx, used.id))).toBeInstanceOf(AppError)
	})

	it("lets exactly one of a signup and a revoke win", async () => {
		const { ctx } = await adminCtx()
		for (let round = 0; round < 4; round++) {
			const created = await invite(ctx, "never")
			const [joined, revoked] = await Promise.allSettled([
				signup(created.code),
				revokeInvite(ctx, created.id),
			])
			const stored = await row(created.id)
			if (joined.status === "fulfilled") {
				expect(stored.usedBy).toBe(joined.value.response.user.id)
				expect(stored.revokedAt).toBeNull()
				expect(revoked.status).toBe("rejected")
				await db.execute(sql`delete from "user" where id = ${joined.value.response.user.id}`)
			} else {
				expect(revoked.status).toBe("fulfilled")
				expect(stored.usedBy).toBeNull()
				expect(stored.revokedAt).not.toBeNull()
			}
		}
	})

	it("still accepts rows inserted the way the pre-admin CLI inserted them", async () => {
		const code = `OLD${randomUUID().slice(0, 5).toUpperCase()}`
		await db.execute(sql`insert into invites (code, note) values (${code}, 'old cli')`)
		const [stored] = await db.select().from(invites).where(eq(invites.code, code))
		made.push(stored!.id)
		expect(stored).toMatchObject({ revokedAt: null })
		expect(stored!.id).toMatch(/^[0-9a-f-]{36}$/)
	})
})
