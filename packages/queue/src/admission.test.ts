import { randomUUID } from "node:crypto"
import { db, documentRaw, documents, documentVersions, eq, pool, sql, user } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { admitExtract, admitImages, getBoss, QUEUES, stopBoss } from "./index"

const suffix = randomUUID()
const userId = `admission-${suffix}`

beforeAll(async () => {
	await db.insert(user).values({ id: userId, name: "Admission", email: `${userId}@example.com` })
	await getBoss()
})
afterAll(async () => {
	await db.execute(
		sql`delete from pgboss.job where data->>'documentId' in (select id::text from documents where user_id = ${userId})
			or data->>'versionId' in (select v.id::text from document_versions v join documents d on d.id = v.document_id where d.user_id = ${userId})`,
	)
	await db.delete(user).where(eq(user.id, userId))
	await stopBoss()
	await pool.end()
})

async function document(status: "failed" | "ready" | "queued" = "failed", trashed = false) {
	const [doc] = await db
		.insert(documents)
		.values({
			userId,
			sourceUrl: `https://example.com/${randomUUID()}`,
			urlHash: randomUUID(),
			status,
			failureReason: status === "failed" ? "timeout" : null,
			deletedAt: trashed ? new Date() : null,
		})
		.returning()
	return doc!
}

async function version(documentId: string, n: number, current = true) {
	const [row] = await db
		.insert(documentVersions)
		.values({
			documentId,
			version: n,
			html: "<p>text</p>",
			text: "text",
			textHash: "hash",
			extractor: "test",
			extractorVersion: "1",
		})
		.returning()
	if (current)
		await db
			.update(documents)
			.set({ currentVersionId: row!.id })
			.where(eq(documents.id, documentId))
	return row!
}

async function jobs(queue: string, key: "documentId" | "versionId", id: string) {
	const result = await db.execute<{ state: string }>(
		sql`select state::text from pgboss.job where name = ${queue} and data->>${key} = ${id}`,
	)
	return result.rows
}

describe("admitExtract", () => {
	it("admits one attempt when many callers retry the same failed document at once", async () => {
		const doc = await document("failed")
		const results = await Promise.all(
			Array.from({ length: 6 }, () => db.transaction((tx) => admitExtract(tx, doc.id, "failed"))),
		)
		expect(results.filter((r) => r.outcome === "admitted")).toHaveLength(1)
		expect(results.filter((r) => r.outcome === "not_failed")).toHaveLength(5)
		expect(await jobs(QUEUES.extract, "documentId", doc.id)).toHaveLength(1)
		const [row] = await db.select().from(documents).where(eq(documents.id, doc.id))
		expect(row).toMatchObject({ status: "queued", failureReason: null })
	})

	it("leaves no job and no queued status when the caller's transaction fails", async () => {
		const doc = await document("failed")
		await expect(
			db.transaction(async (tx) => {
				expect((await admitExtract(tx, doc.id, "failed")).outcome).toBe("admitted")
				throw new Error("audit write failed")
			}),
		).rejects.toThrow("audit write failed")
		expect(await jobs(QUEUES.extract, "documentId", doc.id)).toHaveLength(0)
		const [row] = await db.select().from(documents).where(eq(documents.id, doc.id))
		expect(row).toMatchObject({ status: "failed", failureReason: "timeout" })
	})

	it("refuses missing, trashed and not-failed documents", async () => {
		const admit = (id: string) => db.transaction((tx) => admitExtract(tx, id, "failed"))
		expect((await admit(randomUUID())).outcome).toBe("missing")
		expect((await admit((await document("failed", true)).id)).outcome).toBe("trashed")
		expect((await admit((await document("ready")).id)).outcome).toBe("not_failed")
	})

	it("does not queue a second job behind one that has not started", async () => {
		const doc = await document("ready")
		const admit = (mode: "refresh" | "capture") =>
			db.transaction((tx) => admitExtract(tx, doc.id, mode))
		expect((await admit("capture")).outcome).toBe("admitted")
		expect((await admit("capture")).outcome).toBe("already_pending")
		expect((await admit("refresh")).outcome).toBe("already_pending")
		expect(await jobs(QUEUES.extract, "documentId", doc.id)).toHaveLength(1)
	})

	it("treats a running job as pending for a refresh, but not for a new capture", async () => {
		const doc = await document("ready")
		await db.transaction((tx) => admitExtract(tx, doc.id, "refresh"))
		await db.execute(
			sql`update pgboss.job set state = 'active', started_on = now() where name = ${QUEUES.extract} and data->>'documentId' = ${doc.id}`,
		)
		const refresh = await db.transaction((tx) => admitExtract(tx, doc.id, "refresh"))
		expect(refresh.outcome).toBe("already_pending")
		const capture = await db.transaction((tx) => admitExtract(tx, doc.id, "capture"))
		expect(capture.outcome).toBe("admitted")
	})
})

describe("admitImages", () => {
	it("admits the current version once, however many callers ask", async () => {
		const doc = await document("ready")
		const v = await version(doc.id, 1)
		const results = await Promise.all(
			Array.from({ length: 5 }, () => db.transaction((tx) => admitImages(tx, v.id))),
		)
		expect(results.filter((r) => r.outcome === "admitted")).toHaveLength(1)
		expect(results.filter((r) => r.outcome === "already_pending")).toHaveLength(4)
		expect(await jobs(QUEUES.images, "versionId", v.id)).toHaveLength(1)
	})

	it("refuses superseded, finished, trashed and missing versions", async () => {
		const admit = (id: string) => db.transaction((tx) => admitImages(tx, id))
		const doc = await document("ready")
		const old = await version(doc.id, 1)
		const current = await version(doc.id, 2)
		expect((await admit(old.id)).outcome).toBe("superseded")
		await db
			.update(documentVersions)
			.set({ imagesDone: true })
			.where(eq(documentVersions.id, current.id))
		expect((await admit(current.id)).outcome).toBe("already_done")

		const trashed = await document("ready", true)
		expect((await admit((await version(trashed.id, 1)).id)).outcome).toBe("trashed")
		expect((await admit(randomUUID())).outcome).toBe("missing")
		expect(await jobs(QUEUES.images, "versionId", old.id)).toHaveLength(0)
	})
})

describe("a retry", () => {
	it("drops the copy the server fetched, so the page is fetched again", async () => {
		const doc = await document("failed")
		const raw = (source: "fetch" | "extension") =>
			db
				.insert(documentRaw)
				.values({ documentId: doc.id, rawHtml: Buffer.from(""), source })
				.returning({ id: documentRaw.id })
				.then((rows) => rows[0]!.id)
		await raw("fetch")
		const captured = await raw("extension")
		const admission = await db.transaction((tx) => admitExtract(tx, doc.id, "failed"))
		expect(admission.outcome).toBe("admitted")
		const left = await db
			.select({ id: documentRaw.id })
			.from(documentRaw)
			.where(eq(documentRaw.documentId, doc.id))
		expect(left).toEqual([{ id: captured }])
	})
})
