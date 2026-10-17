import { createHash, createHmac, randomUUID } from "node:crypto"
import {
	adminAuditEvents,
	db,
	documents,
	documentVersions,
	editionReports,
	eq,
	highlights,
	highlightShares,
} from "@klipstack/db"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { authorizeAdmin } from "~/lib/admin.server"
import { reportShare } from "~/lib/edition-reports.server"
import { env } from "~/lib/env.server"
import { FORM_MIN_MS, formToken } from "~/lib/invite-requests.server"
import { adminFixtures } from "~/test/admin-fixtures"

const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; text: string }[] }))
vi.mock("~/lib/email.server", async (original) => {
	const real = await original<typeof import("~/lib/email.server")>()
	return {
		...real,
		sendEmail: async (email: { to: string; subject: string; text: string }) => {
			mail.sent.push(email)
		},
	}
})

const { dismissShareReports, listRemovedShares, listReportedShares, removeShare, restoreShare } =
	await import("./admin-reports.server")
const { shareHighlight, stopSharingHighlight } = await import("~/commands/highlight-shares.server")
const { getPublicShare, getShareState } = await import("./highlight-shares.server")

const fx = adminFixtures("admin-share-reports")
afterAll(fx.cleanup)
beforeEach(() => {
	mail.sent.length = 0
})

async function adminCtx() {
	const admin = await fx.account({ role: "admin" })
	return authorizeAdmin(await admin.session())
}

/** A shared highlight with two reports, one from an address. */
async function reported() {
	const owner = await fx.account()
	const text = "Alpha bravo charlie."
	const [doc] = await db
		.insert(documents)
		.values({
			userId: owner.id,
			sourceUrl: `https://example.com/${Math.random()}`,
			urlHash: `${owner.id}-${Math.random()}`,
			title: "The piece",
			status: "ready",
		})
		.returning({ id: documents.id })
	const [v] = await db
		.insert(documentVersions)
		.values({
			documentId: doc!.id,
			version: 1,
			html: `<p>${text}</p>`,
			text,
			textHash: createHash("sha256").update(`${text}${Math.random()}`).digest("hex"),
			extractor: "test",
			extractorVersion: "0",
		})
		.returning({ id: documentVersions.id })
	const [h] = await db
		.insert(highlights)
		.values({
			userId: owner.id,
			documentId: doc!.id,
			versionId: v!.id,
			startOffset: 0,
			endOffset: 11,
			exact: "Alpha bravo",
		})
		.returning({ id: highlights.id })
	const { publicId } = await shareHighlight(owner.id, h!.id, { includeNote: true, locale: "en" })
	const [share] = await db
		.select({ id: highlightShares.id })
		.from(highlightShares)
		.where(eq(highlightShares.highlightId, h!.id))
	const reporter = `reporter-${share!.id}@example.com`
	await db.insert(editionReports).values([
		{ shareId: share!.id, reason: "spam", details: "Casino", email: reporter, locale: "es" },
		{ shareId: share!.id, reason: "abuse", details: "Insults", locale: "en" },
	])
	return { owner, highlightId: h!.id, shareId: share!.id, publicId, reporter }
}

describe("reports on shared highlights", () => {
	it("lists them with their reports, named by quote and article", async () => {
		const ctx = await adminCtx()
		const { owner, shareId, publicId } = await reported()
		expect((await listReportedShares(ctx)).find((s) => s.id === shareId)).toMatchObject({
			kind: "share",
			href: `/h/${publicId}`,
			title: "Alpha bravo — The piece",
			owner: { id: owner.id },
			count: 2,
		})
	})

	it("removes one: down with the reason shown, not shareable again, reports closed, people told", async () => {
		const ctx = await adminCtx()
		const { owner, highlightId, shareId, publicId, reporter } = await reported()
		expect(await removeShare(ctx, shareId, { ground: "spam", note: "Advertising." })).toEqual({
			reports: 2,
			ownerEmailed: true,
			reportersEmailed: 1,
		})
		expect(await getPublicShare(publicId)).toEqual({ status: "removed" })
		expect(await getShareState(owner.id, highlightId)).toEqual({ removed: true })
		await expect(
			shareHighlight(owner.id, highlightId, { includeNote: true, locale: "en" }),
		).rejects.toMatchObject({ code: "share_removed" })
		expect(
			await db.select().from(editionReports).where(eq(editionReports.shareId, shareId)),
		).toEqual([])
		const toOwner = mail.sent.find((m) => m.to === owner.email)!
		expect(toOwner.subject).toBe("We removed a highlight you shared")
		expect(toOwner.text).toContain("Advertising.")
		expect(mail.sent.find((m) => m.to === reporter)?.subject).toBe(
			"Retiramos una página que denunciaste",
		)
		const [audit] = await db
			.select()
			.from(adminAuditEvents)
			.where(eq(adminAuditEvents.targetId, shareId))
		expect(audit).toMatchObject({ action: "share.remove", targetKind: "highlight_share" })
		expect((await listRemovedShares(ctx)).map((s) => s.id)).toContain(shareId)

		// Restored: the owner may share it again, at a new address.
		await restoreShare(ctx, shareId)
		expect(await getShareState(owner.id, highlightId)).toBeNull()
		const again = await shareHighlight(owner.id, highlightId, { includeNote: true, locale: "en" })
		expect(again.publicId).not.toBe(publicId)
	})

	it("dismisses reports and leaves it up", async () => {
		const ctx = await adminCtx()
		const { shareId, publicId } = await reported()
		expect(await dismissShareReports(ctx, shareId)).toEqual({ reports: 2, reportersEmailed: 1 })
		expect((await getPublicShare(publicId))?.status).toBe("live")
		await expect(dismissShareReports(ctx, shareId)).rejects.toMatchObject({ code: "not_found" })
	})
})

describe("the report form on a shared highlight", () => {
	const from = () => {
		const ip = `share-report-${randomUUID()}`
		return new Headers({
			"x-klipstack-client-ip": ip,
			"x-klipstack-client-signature": createHmac("sha256", env.BETTER_AUTH_SECRET)
				.update(ip)
				.digest("hex"),
		})
	}
	const send = (publicId: string) =>
		reportShare(
			{
				publicId,
				reason: "copyright",
				details: "  Whole chapter  ",
				locale: "en",
				token: formToken(Date.now() - FORM_MIN_MS - 1000, "edition-report"),
				trap: "",
			},
			from(),
		)

	it("stores a report on a live one, and answers the same, storing nothing, once it is stopped", async () => {
		const { owner, highlightId, shareId, publicId } = await reported()
		expect(await send(publicId)).toBe("received")
		const stored = () => db.select().from(editionReports).where(eq(editionReports.shareId, shareId))
		expect((await stored()).map((r) => [r.reason, r.details, r.editionId])).toContainEqual([
			"copyright",
			"Whole chapter",
			null,
		])
		await stopSharingHighlight(owner.id, highlightId)
		const before = (await stored()).length
		expect(await send(publicId)).toBe("received")
		expect((await stored()).length).toBe(before)
	})
})
