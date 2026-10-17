import { randomUUID } from "node:crypto"
import { db, editionReports, editions, eq, inArray, pool, user } from "@klipstack/db"
import type { Email } from "@klipstack/email"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { handleReportDigest } from "./report-digest"

// Scoped to this file's rows: a shared development database keeps everyone else's.
const tag = `report-digest-${randomUUID().slice(0, 8)}`
const admin = { id: `${tag}-admin`, email: `${tag}-admin@example.com` }
const owner = `${tag}-owner`
let editionId: string

beforeAll(async () => {
	await db.insert(user).values([
		{
			id: admin.id,
			name: "Digest admin",
			email: admin.email,
			role: "admin",
			emailVerified: true,
			locale: "es",
		},
		{ id: owner, name: "Owner", email: `${owner}@example.com` },
	])
	const [edition] = await db
		.insert(editions)
		.values({
			userId: owner,
			title: "Reported",
			locale: "en",
			timeZone: "UTC",
			publishedAt: new Date(),
		})
		.returning({ id: editions.id })
	editionId = edition!.id
})
beforeEach(async () => {
	await db.delete(editionReports).where(eq(editionReports.editionId, editionId))
})
afterAll(async () => {
	await db.delete(user).where(inArray(user.id, [admin.id, owner]))
	await pool.end()
})

async function reports(count: number) {
	const rows = await db
		.insert(editionReports)
		.values(
			Array.from({ length: count }, () => ({
				editionId,
				reason: "spam" as const,
				details: `${tag} details`,
				email: `${tag}-${randomUUID()}@example.com`,
				locale: "en",
			})),
		)
		.returning({ id: editionReports.id })
	return rows.map((row) => row.id)
}

const counted = async (ids: string[]) =>
	(await db.select().from(editionReports).where(inArray(editionReports.id, ids))).every(
		(row) => row.notifiedAt !== null,
	)

function outbox() {
	const sent: Email[] = []
	return { sent, send: async (email: Email) => void sent.push(email) }
}

describe("handleReportDigest", () => {
	it("tells each admin, in their language, how many reports are new, then marks them", async () => {
		const ids = await reports(2)
		const mail = outbox()
		const digest = await handleReportDigest({ ...mail, only: ids })
		expect(digest.fresh).toBe(2)
		const [email, ...more] = mail.sent.filter((sent) => sent.to === admin.email)
		expect(more).toHaveLength(0)
		expect(email!.subject).toBe("2 denuncias nuevas en Klipstack")
		expect(email!.text).toContain("/admin/reports")
		// Nothing a visitor typed: no details, no address.
		expect(email!.text).not.toContain(tag)
		expect(email!.html).not.toContain(tag)
		expect(await counted(ids)).toBe(true)
	})

	it("sends nothing when no report is new", async () => {
		const ids = await reports(1)
		await handleReportDigest({ ...outbox(), only: ids })
		const mail = outbox()
		expect(await handleReportDigest({ ...mail, only: ids })).toEqual({ fresh: 0, recipients: 0 })
		expect(mail.sent).toHaveLength(0)
	})

	it("marks nothing when a send fails, so the retry sends it again", async () => {
		const ids = await reports(1)
		const failing = async () => {
			throw new Error("down")
		}
		await expect(handleReportDigest({ send: failing, only: ids })).rejects.toThrow("down")
		expect(await counted(ids)).toBe(false)
	})
})
