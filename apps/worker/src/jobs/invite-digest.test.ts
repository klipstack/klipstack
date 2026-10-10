import { randomUUID } from "node:crypto"
import { db, eq, inArray, inviteRequests, like, pool, user } from "@klipstack/db"
import type { Email } from "@klipstack/email"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { handleInviteDigest } from "./invite-digest"

// Scoped to this file's rows: a shared development database keeps everyone else's.
const tag = `digest-${randomUUID().slice(0, 8)}`
const admin = { id: `${tag}-admin`, email: `${tag}-admin@example.com` }

beforeAll(async () => {
	await db.insert(user).values({
		id: admin.id,
		name: "Digest admin",
		email: admin.email,
		role: "admin",
		emailVerified: true,
		locale: "es",
	})
})
beforeEach(async () => {
	await db.delete(inviteRequests).where(like(inviteRequests.email, `${tag}-%`))
})
afterAll(async () => {
	await db.delete(inviteRequests).where(like(inviteRequests.email, `${tag}-%`))
	await db.delete(user).where(eq(user.id, admin.id))
	await pool.end()
})

async function requests(count: number) {
	const rows = await db
		.insert(inviteRequests)
		.values(
			Array.from({ length: count }, () => ({
				email: `${tag}-${randomUUID()}@example.com`,
				note: `${tag} note`,
				locale: "en",
			})),
		)
		.returning({ id: inviteRequests.id })
	return rows.map((row) => row.id)
}

const counted = async (ids: string[]) =>
	(await db.select().from(inviteRequests).where(inArray(inviteRequests.id, ids))).every(
		(row) => row.notifiedAt !== null,
	)

function outbox() {
	const sent: Email[] = []
	return { sent, send: async (email: Email) => void sent.push(email) }
}

describe("handleInviteDigest", () => {
	it("tells each admin, in their language, how many requests are new, then marks them", async () => {
		const ids = await requests(2)
		const mail = outbox()
		const digest = await handleInviteDigest(mail)
		expect(digest.fresh).toBeGreaterThanOrEqual(2)
		const [email, ...more] = mail.sent.filter((sent) => sent.to === admin.email)
		expect(more).toHaveLength(0)
		expect(email!.subject).toMatch(/^\d+ nuevas solicitudes de invitación$/)
		expect(email!.text).toContain("/admin/requests")
		// Nothing a visitor typed: no address, no note.
		expect(email!.text).not.toContain(tag)
		expect(email!.html).not.toContain(tag)
		expect(await counted(ids)).toBe(true)
	})

	it("sends nothing when no request is new", async () => {
		await requests(1)
		await handleInviteDigest(outbox())
		const mail = outbox()
		expect(await handleInviteDigest(mail)).toEqual({ fresh: 0, recipients: 0 })
		expect(mail.sent).toHaveLength(0)
	})

	it("marks nothing when a send fails, so the retry sends it again", async () => {
		const ids = await requests(1)
		const failing = async () => {
			throw new Error("delivery failed")
		}
		await expect(handleInviteDigest({ send: failing })).rejects.toThrow("delivery failed")
		expect(await counted(ids)).toBe(false)
		const mail = outbox()
		await handleInviteDigest(mail)
		expect(mail.sent.some((sent) => sent.to === admin.email)).toBe(true)
		expect(await counted(ids)).toBe(true)
	})
})
