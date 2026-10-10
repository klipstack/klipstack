import { randomUUID } from "node:crypto"
import { db, documents, eq, pool, sql, user } from "@klipstack/db"
import { admitExtract, stopBoss } from "@klipstack/queue"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const notify = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock("@klipstack/db", async (original) => ({
	...(await original<typeof import("@klipstack/db")>()),
	notifyDocumentEvent: notify,
}))

const { settleStuckExtractions } = await import("./sweep")

const userId = `sweep-${randomUUID()}`

beforeAll(async () => {
	await db.insert(user).values({ id: userId, name: "Sweep", email: `${userId}@example.com` })
})
afterAll(async () => {
	await db.execute(
		sql`delete from pgboss.job where data->>'documentId' in (select id::text from documents where user_id = ${userId})`,
	)
	await db.delete(user).where(eq(user.id, userId))
	await stopBoss()
	await pool.end()
})

const article = async (values: Partial<typeof documents.$inferInsert>) => {
	const [doc] = await db
		.insert(documents)
		.values({ userId, sourceUrl: "https://example.com/a", urlHash: randomUUID(), ...values })
		.returning()
	return doc!
}
const statusOf = async (id: string) =>
	(await db.query.documents.findFirst({ where: eq(documents.id, id) }))!

describe("settleStuckExtractions", () => {
	it("settles the extractions whose job is gone, and leaves the rest alone", async () => {
		const lost = await article({ status: "processing" })
		const readable = await article({ status: "queued", currentVersionId: randomUUID() })
		const trashed = await article({ status: "queued", deletedAt: new Date() })
		const waiting = await article({ status: "ready" })
		await db.transaction((tx) => admitExtract(tx, waiting.id, "refresh"))

		const settled = await settleStuckExtractions([userId])
		expect(settled).toEqual(expect.arrayContaining([lost.id, readable.id]))
		expect(settled).not.toContain(trashed.id)
		expect(settled).not.toContain(waiting.id)
		expect(await statusOf(lost.id)).toMatchObject({ status: "failed", failureReason: "timeout" })
		expect(await statusOf(readable.id)).toMatchObject({ status: "ready" })
		expect(await statusOf(trashed.id)).toMatchObject({ status: "queued" })
		expect(await statusOf(waiting.id)).toMatchObject({ status: "queued" })
		expect(notify).toHaveBeenCalledWith(
			expect.objectContaining({ documentId: lost.id, kind: "failed" }),
		)
	})
})
