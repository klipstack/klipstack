import { adminAuditEvents, db, editionReports, editions, eq } from "@klipstack/db"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { authorizeAdmin } from "~/lib/admin.server"
import { SUPPORT_CONTACT } from "~/lib/privacy-policy/types"
import { adminFixtures } from "~/test/admin-fixtures"

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

const { dismissReports, listRemovedEditions, listReportedEditions, removeEdition, restoreEdition } =
	await import("./admin-reports.server")
const { publishEdition } = await import("~/commands/editions-actions.server")

const fx = adminFixtures("admin-reports")
afterAll(fx.cleanup)
beforeEach(() => {
	mail.fail = false
	mail.sent.length = 0
})

async function adminCtx() {
	const admin = await fx.account({ role: "admin" })
	return authorizeAdmin(await admin.session())
}

/** A public edition with two reports: one with an address (twice, in two cases), one without. */
async function reported() {
	const owner = await fx.account()
	const [edition] = await db
		.insert(editions)
		.values({
			userId: owner.id,
			title: "Working title",
			locale: "en",
			timeZone: "UTC",
			published: { v: 1, title: "Week 36" },
			publishedAt: new Date(),
		})
		.returning({ id: editions.id, publicId: editions.publicId })
	const reporter = `reporter-${edition!.id}@example.com`
	await db.insert(editionReports).values([
		{
			editionId: edition!.id,
			reason: "spam",
			details: "Links to a casino",
			email: reporter,
			locale: "es",
		},
		{ editionId: edition!.id, reason: "spam", details: "Same here", email: reporter, locale: "es" },
		{ editionId: edition!.id, reason: "abuse", details: "Insults", locale: "en" },
	])
	return { owner, edition: edition!, reporter }
}

const row = async (id: string) => (await db.select().from(editions).where(eq(editions.id, id)))[0]!
const openReports = async (id: string) =>
	db.select().from(editionReports).where(eq(editionReports.editionId, id))

describe("the reports queue", () => {
	it("lists reported editions with their reports, newest first, under the public title", async () => {
		const ctx = await adminCtx()
		const { owner, edition } = await reported()
		const listed = (await listReportedEditions(ctx)).find((e) => e.id === edition.id)
		expect(listed).toMatchObject({
			publicId: edition.publicId,
			title: "Week 36",
			owner: { id: owner.id },
			count: 3,
		})
		expect(listed!.reports.map((r) => r.reason).sort()).toEqual(["abuse", "spam", "spam"])
	})

	it("removes an edition: down for good, its reports closed, the owner and reporters told", async () => {
		const ctx = await adminCtx()
		const { owner, edition, reporter } = await reported()
		await expect(
			removeEdition(ctx, edition.id, { ground: "spam", note: "  " }),
		).rejects.toMatchObject({ code: "invalid_request" })
		const result = await removeEdition(ctx, edition.id, {
			ground: "spam",
			note: "Every link goes to a casino.",
		})
		expect(result).toEqual({ reports: 3, ownerEmailed: true, reportersEmailed: 1 })
		const after = await row(edition.id)
		expect(after).toMatchObject({
			removedGround: "spam",
			removedNote: "Every link goes to a casino.",
		})
		expect(after.removedAt).toBeInstanceOf(Date)
		expect(after.unpublishedAt).toBeInstanceOf(Date)
		expect(await openReports(edition.id)).toEqual([])

		const toOwner = mail.sent.find((sent) => sent.to === owner.email)!
		expect(toOwner.subject).toContain("Week 36")
		expect(toOwner.text).toContain("Every link goes to a casino.")
		expect(toOwner.text).toContain("spam or misleading")
		expect(toOwner.text).toContain(SUPPORT_CONTACT)
		expect(toOwner.text).toContain("/terms#editions")
		// One email per address, in its language; nothing of the reports reaches the owner.
		const toReporter = mail.sent.filter((sent) => sent.to === reporter)
		expect(toReporter).toHaveLength(1)
		expect(toReporter[0]!.subject).toBe("Retiramos una página que denunciaste")
		expect(toOwner.text).not.toContain("Links to a casino")
		expect(toOwner.text).not.toContain(reporter)

		// The owner cannot bring it back.
		await expect(publishEdition(owner.id, edition.id)).rejects.toMatchObject({
			code: "edition_removed",
		})
		const [event] = await db
			.select()
			.from(adminAuditEvents)
			.where(eq(adminAuditEvents.targetId, edition.id))
		expect(event).toMatchObject({
			action: "edition.remove",
			targetKind: "edition",
			metadata: { ownerId: owner.id, ground: "spam", reports: 3 },
		})
		expect((await listRemovedEditions(ctx)).map((e) => e.id)).toContain(edition.id)
		// A second admin a moment later finds nothing to remove.
		await expect(
			removeEdition(ctx, edition.id, { ground: "spam", note: "Again" }),
		).rejects.toMatchObject({ code: "not_found" })

		await restoreEdition(ctx, edition.id)
		expect(await row(edition.id)).toMatchObject({
			removedAt: null,
			removedGround: null,
			removedNote: null,
		})
		await expect(restoreEdition(ctx, edition.id)).rejects.toMatchObject({ code: "not_found" })
	})

	it("still removes when the owner's email fails, and says so", async () => {
		const ctx = await adminCtx()
		const { edition } = await reported()
		mail.fail = true
		expect(await removeEdition(ctx, edition.id, { ground: "abuse", note: "Insults." })).toEqual({
			reports: 3,
			ownerEmailed: false,
			reportersEmailed: 0,
		})
		expect((await row(edition.id)).removedAt).toBeInstanceOf(Date)
	})

	it("dismisses reports: the edition stays up, reporters with an address are told", async () => {
		const ctx = await adminCtx()
		const { edition, reporter } = await reported()
		expect(await dismissReports(ctx, edition.id)).toEqual({ reports: 3, reportersEmailed: 1 })
		expect(await row(edition.id)).toMatchObject({ removedAt: null, unpublishedAt: null })
		expect(await openReports(edition.id)).toEqual([])
		expect(mail.sent.map((sent) => [sent.to, sent.subject])).toEqual([
			[reporter, "Revisamos una página que denunciaste"],
		])
		await expect(dismissReports(ctx, edition.id)).rejects.toMatchObject({ code: "not_found" })
	})
})
