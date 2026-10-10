import { randomUUID } from "node:crypto"
import { adminAuditEvents, db, eq, inviteRequests, invites, like } from "@klipstack/db"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { authorizeAdmin } from "~/lib/admin.server"
import { AppError } from "~/lib/app-error"
import { adminFixtures, thrownBy } from "~/test/admin-fixtures"

const mail = vi.hoisted(() => ({
	fail: false,
	sent: [] as { to: string; subject: string; text: string }[],
}))
vi.mock("~/lib/email.server", async (original) => {
	const real = await original<typeof import("~/lib/email.server")>()
	return {
		...real,
		sendEmail: async (email: { to: string; subject: string; text: string }) => {
			if (mail.fail) throw new real.EmailError("EMAIL_SEND_FAILED", "Test delivery failure")
			mail.sent.push(email)
		},
	}
})

const { approveInviteRequest, dismissInviteRequest, listInviteRequests } =
	await import("./admin-invite-requests.server")

const fx = adminFixtures("admin-requests")
afterAll(async () => {
	await db.delete(inviteRequests).where(like(inviteRequests.email, "admin-requests-%"))
	await fx.cleanup()
})
beforeEach(() => {
	mail.fail = false
	mail.sent.length = 0
})

async function adminCtx() {
	const admin = await fx.account({ role: "admin" })
	return authorizeAdmin(await admin.session())
}

async function request(locale = "es") {
	const email = `admin-requests-${randomUUID()}@example.com`
	const [row] = await db
		.insert(inviteRequests)
		.values({ email, note: "For my book club", locale })
		.returning({ id: inviteRequests.id })
	return { id: row!.id, email }
}

const exists = async (id: string) =>
	(await db.select().from(inviteRequests).where(eq(inviteRequests.id, id))).length > 0

describe("approveInviteRequest", () => {
	it("creates an invite, deletes the request, audits it, and emails the code", async () => {
		const ctx = await adminCtx()
		const { id, email } = await request("es")
		const listed = await listInviteRequests(ctx, {})
		expect(listed.requests.find((r) => r.id === id)).toMatchObject({
			email,
			note: "For my book club",
		})
		expect(listed.pending).toBeGreaterThan(0)

		const result = await approveInviteRequest(ctx, id)
		expect(result).toMatchObject({ email, emailed: true })
		expect(await exists(id)).toBe(false)

		const [invite] = await db.select().from(invites).where(eq(invites.id, result.inviteId))
		expect(invite).toMatchObject({ code: result.code, note: email, createdBy: ctx.userId })
		const days = (invite!.expiresAt!.getTime() - Date.now()) / 86_400_000
		expect(days).toBeGreaterThan(29.9)
		expect(days).toBeLessThanOrEqual(30)

		const events = await db
			.select()
			.from(adminAuditEvents)
			.where(eq(adminAuditEvents.correlationId, ctx.correlationId))
		expect(events.map((e) => e.action).sort()).toEqual(["invite.create", "invite_request.approve"])
		expect(JSON.stringify(events)).not.toContain(email)
		expect(JSON.stringify(events)).not.toContain(result.code)

		expect(mail.sent).toHaveLength(1)
		const [sent] = mail.sent
		expect(sent!.to).toBe(email)
		// In the language the request was made in.
		expect(sent!.subject).toBe("Tu invitación a Klipstack")
		expect(sent!.text).toContain(`/signup?invite=${result.code}`)
	})

	it("keeps the invite when the email fails, and hands the admin its code", async () => {
		const ctx = await adminCtx()
		const { id } = await request()
		mail.fail = true
		const result = await approveInviteRequest(ctx, id)
		expect(result.emailed).toBe(false)
		expect(await db.select().from(invites).where(eq(invites.id, result.inviteId))).toHaveLength(1)
		expect(await exists(id)).toBe(false)
	})

	it("refuses a request that is already answered", async () => {
		const ctx = await adminCtx()
		const { id } = await request()
		await approveInviteRequest(ctx, id)
		const error = await thrownBy(() => approveInviteRequest(ctx, id))
		expect(error).toBeInstanceOf(AppError)
		expect((error as AppError).code).toBe("not_found")
		expect(mail.sent).toHaveLength(1)
	})
})

describe("dismissInviteRequest", () => {
	it("deletes the request and audits it, and nobody is emailed", async () => {
		const ctx = await adminCtx()
		const { id } = await request()
		expect(await dismissInviteRequest(ctx, id)).toEqual({ changed: true })
		expect(await exists(id)).toBe(false)
		const [event] = await db
			.select()
			.from(adminAuditEvents)
			.where(eq(adminAuditEvents.correlationId, ctx.correlationId))
		expect(event).toMatchObject({
			action: "invite_request.dismiss",
			targetKind: "invite_request",
			targetId: id,
		})
		expect(mail.sent).toHaveLength(0)
		const again = await thrownBy(() => dismissInviteRequest(ctx, id))
		expect((again as AppError).code).toBe("not_found")
	})
})
