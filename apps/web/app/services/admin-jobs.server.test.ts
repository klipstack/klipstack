import { randomUUID } from "node:crypto"
import { adminAuditEvents, db, documents, documentVersions, eq, sql } from "@klipstack/db"
import { getBoss, QUEUES, stopBoss } from "@klipstack/queue"
import { afterAll, describe, expect, it, vi } from "vitest"
import { retryArticle } from "~/commands/articles.server"
import { ADMIN_LIMITS, authorizeAdmin } from "~/lib/admin.server"
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
const notify = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock("@klipstack/db", async (original) => ({
	...(await original<typeof import("@klipstack/db")>()),
	notifyDocumentEvent: notify,
}))

const { documentErrorCategory, jobErrorCategory, listFailedDocuments, listFailedJobs, retryJob } =
	await import("./admin-jobs.server")

const fx = adminFixtures("admin-jobs")
const documentIds: string[] = []
afterAll(async () => {
	for (const id of documentIds)
		await db.execute(sql`delete from pgboss.job where data->>'documentId' = ${id}
			or data->>'versionId' in (select id::text from document_versions where document_id = ${id}::uuid)`)
	await fx.cleanup()
	await stopBoss()
})

async function failedDocument(userId: string, extra: Partial<typeof documents.$inferInsert> = {}) {
	const [doc] = await db
		.insert(documents)
		.values({
			userId,
			sourceUrl: `https://example.com/private-path-${randomUUID()}`,
			urlHash: randomUUID(),
			title: "A private title",
			status: "failed",
			failureReason: "http_error:404",
			...extra,
		})
		.returning()
	documentIds.push(doc!.id)
	return doc!
}

async function version(documentId: string, n: number) {
	const [row] = await db
		.insert(documentVersions)
		.values({
			documentId,
			version: n,
			html: "<p>private body</p>",
			text: "private body",
			textHash: "h",
			extractor: "t",
			extractorVersion: "1",
		})
		.returning()
	await db.update(documents).set({ currentVersionId: row!.id }).where(eq(documents.id, documentId))
	return row!
}

/** A retained failed job, made through pg-boss itself: sent with no retries, fetched, failed. */
async function failedJob(queue: "images" | "export", data: Record<string, string>) {
	const boss = await getBoss()
	const id = await boss.send(queue, data, { retryLimit: 0, priority: 1000 })
	for (let i = 0; i < 50; i++) {
		const jobs = await boss.fetch(queue, { priority: true })
		for (const job of jobs) {
			if (job.id === id) {
				await boss.fail(queue, id!, new Error("secret exception text https://private.example"))
				return id!
			}
			// Someone else's job (a dev database): put it back untouched.
			await boss.retry(queue, job.id)
		}
	}
	throw new Error("could not fetch the fixture job")
}

const jobsFor = async (key: string, id: string) =>
	(
		await db.execute<{ state: string }>(
			sql`select state::text from pgboss.job where data->>${key} = ${id}`,
		)
	).rows

async function setup() {
	const admin = await fx.account({ role: "admin" })
	const owner = await fx.account()
	return { admin, owner, ctx: await authorizeAdmin(await admin.session()) }
}

describe("error categories", () => {
	it("passes known codes and hides everything else", () => {
		expect(documentErrorCategory("http_error:404")).toBe("http_error:404")
		expect(documentErrorCategory("timeout")).toBe("timeout")
		expect(documentErrorCategory("http_error:<script>")).toBe("http_error")
		expect(documentErrorCategory("connect ECONNREFUSED 10.0.0.1")).toBe("unknown")
		expect(documentErrorCategory(null)).toBe("unknown")
		expect(jobErrorCategory({ code: "too_large", message: "x" })).toBe("too_large")
		expect(jobErrorCategory({ message: "job failed by timeout in active state" })).toBe("timeout")
		expect(jobErrorCategory({ code: "ECONNRESET", message: "secret" })).toBe("unknown")
		expect(jobErrorCategory(null)).toBe("unknown")
	})
})

describe("failed extractions", () => {
	it("lists a failed document that has no failed queue job, without its content", async () => {
		const { owner, ctx } = await setup()
		const doc = await failedDocument(owner.id)
		await failedDocument(owner.id, { deletedAt: new Date() })
		const list = await listFailedDocuments(ctx, {})
		const mine = list.documents.filter((d) => d.ownerId === owner.id)
		expect(mine).toHaveLength(1)
		expect(mine[0]).toEqual({
			documentId: doc.id,
			ownerId: owner.id,
			category: "http_error:404",
			createdAt: expect.any(String),
			failedAt: expect.any(String),
		})
		expect(JSON.stringify(list)).not.toMatch(/private-path|private title/)
	})

	it("admits one attempt from two admins and the owner retrying at once", async () => {
		const { owner, ctx } = await setup()
		const other = await authorizeAdmin(await (await fx.account({ role: "admin" })).session())
		const doc = await failedDocument(owner.id)
		notify.mockClear()
		const results = await Promise.allSettled([
			retryJob(ctx, { kind: "extract", documentId: doc.id }),
			retryJob(other, { kind: "extract", documentId: doc.id }),
			retryJob(ctx, { kind: "extract", documentId: doc.id }),
			retryArticle(owner.id, doc.id).then((r) => (r.queued ? r : false)),
		])
		const admitted = results.filter((r) => r.status === "fulfilled" && r.value !== false)
		expect(admitted).toHaveLength(1)
		for (const r of results)
			if (r.status === "rejected") expect(r.reason).toMatchObject({ status: 409 })
		expect(await jobsFor("documentId", doc.id)).toHaveLength(1)
		expect(notify).toHaveBeenCalledTimes(1)
		expect(notify).toHaveBeenCalledWith({ userId: owner.id, documentId: doc.id, kind: "queued" })
		const events = await db
			.select()
			.from(adminAuditEvents)
			.where(eq(adminAuditEvents.targetId, doc.id))
		expect(events.length).toBeLessThanOrEqual(1)
	})

	it("leaves the document failed, with no job, when the audit event cannot be written", async () => {
		const { owner, ctx } = await setup()
		const doc = await failedDocument(owner.id)
		audit.fail = true
		try {
			await expect(retryJob(ctx, { kind: "extract", documentId: doc.id })).rejects.toThrow(
				"audit unavailable",
			)
		} finally {
			audit.fail = false
		}
		const [row] = await db.select().from(documents).where(eq(documents.id, doc.id))
		expect(row).toMatchObject({ status: "failed", failureReason: "http_error:404" })
		expect(await jobsFor("documentId", doc.id)).toHaveLength(0)
	})

	it("refuses invalid, missing, trashed, not-failed and already-queued targets", async () => {
		const { owner, ctx } = await setup()
		const retry = (documentId: string) =>
			thrownBy(() => retryJob(ctx, { kind: "extract", documentId }))
		expect(await retry("not-a-uuid")).toMatchObject({ status: 400 })
		expect(await retry(randomUUID())).toMatchObject({ status: 404 })
		const trashed = await failedDocument(owner.id, { deletedAt: new Date() })
		expect(await retry(trashed.id)).toMatchObject({ status: 409, code: "trashed" })
		const ready = await failedDocument(owner.id, { status: "ready", failureReason: null })
		expect(await retry(ready.id)).toMatchObject({ status: 409, code: "not_failed" })
		const doc = await failedDocument(owner.id)
		await retryJob(ctx, { kind: "extract", documentId: doc.id })
		expect(await retry(doc.id)).toMatchObject({ status: 409 })
	})
})

describe("failed image jobs", () => {
	it("lists them without payload or exception text, and retries only an eligible one", async () => {
		const { owner, ctx } = await setup()
		const doc = await failedDocument(owner.id, { status: "ready", failureReason: null })
		const v1 = await version(doc.id, 1)
		const jobId = await failedJob("images", { versionId: v1.id })

		const list = await listFailedJobs(ctx, {})
		const mine = list.jobs.find((j) => j.jobId === jobId)!
		expect(mine).toMatchObject({
			queue: "images",
			ownerId: owner.id,
			documentId: doc.id,
			versionId: v1.id,
			category: "unknown",
			retryable: true,
			followUp: null,
		})
		expect(JSON.stringify(list)).not.toMatch(/secret exception|private\.example|private body/)

		await retryJob(ctx, { kind: "images", jobId })
		expect((await jobsFor("versionId", v1.id)).map((j) => j.state).sort()).toEqual([
			"created",
			"failed",
		])
		expect(await thrownBy(() => retryJob(ctx, { kind: "images", jobId }))).toMatchObject({
			status: 409,
			code: "already_pending",
		})
		const after = (await listFailedJobs(ctx, {})).jobs.find((j) => j.jobId === jobId)!
		expect(after.followUp).toEqual({ state: "queued" })
		const events = await db
			.select()
			.from(adminAuditEvents)
			.where(eq(adminAuditEvents.targetId, jobId))
		expect(events).toHaveLength(1)
		expect(events[0]!.metadata).toMatchObject({ sourceJobId: jobId, versionId: v1.id })
	}, 30_000)

	it("keeps an old failure visible but not retryable once a later attempt finished or the version changed", async () => {
		const { owner, ctx } = await setup()
		const doc = await failedDocument(owner.id, { status: "ready", failureReason: null })
		const v1 = await version(doc.id, 1)
		const jobId = await failedJob("images", { versionId: v1.id })
		await db
			.update(documentVersions)
			.set({ imagesDone: true })
			.where(eq(documentVersions.id, v1.id))
		expect(await thrownBy(() => retryJob(ctx, { kind: "images", jobId }))).toMatchObject({
			status: 409,
			code: "already_done",
		})
		await db
			.update(documentVersions)
			.set({ imagesDone: false })
			.where(eq(documentVersions.id, v1.id))
		await version(doc.id, 2)
		expect(await thrownBy(() => retryJob(ctx, { kind: "images", jobId }))).toMatchObject({
			status: 409,
			code: "superseded",
		})
		const listed = (await listFailedJobs(ctx, {})).jobs.find((j) => j.jobId === jobId)!
		expect(listed.retryable).toBe(false)
		await db.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, doc.id))
		expect(await thrownBy(() => retryJob(ctx, { kind: "images", jobId }))).toMatchObject({
			status: 409,
		})
	}, 30_000)

	it("does not find a job of another queue, whatever its ID", async () => {
		const { owner, ctx } = await setup()
		const jobId = await failedJob("export", { userId: owner.id, requestId: randomUUID() })
		expect(await thrownBy(() => retryJob(ctx, { kind: "images", jobId }))).toMatchObject({
			status: 404,
		})
		const listed = (await listFailedJobs(ctx, {})).jobs.find((j) => j.jobId === jobId)!
		expect(listed).toMatchObject({ queue: "export", ownerId: owner.id, retryable: false })
		await db.execute(sql`select 1`)
		const boss = await getBoss()
		await boss.deleteJob(QUEUES.export, jobId)
	}, 30_000)
})

describe("limits", () => {
	it("stops an admin at 30 retry admissions an hour", async () => {
		const { owner, ctx } = await setup()
		await db.execute(sql`
			insert into auth_limits (key, hits, reset_at)
			values (${`${ADMIN_LIMITS.retry.namespace}:${ctx.userId}`}, ${ADMIN_LIMITS.retry.limit}, now() + interval '10 minutes')`)
		const doc = await failedDocument(owner.id)
		const error = await thrownBy(() => retryJob(ctx, { kind: "extract", documentId: doc.id }))
		expect(error).toMatchObject({ status: 429 })
		expect((error as { retryAfter: number }).retryAfter).toBeLessThanOrEqual(600)
		const [row] = await db.select().from(documents).where(eq(documents.id, doc.id))
		expect(row!.status).toBe("failed")
	})
})
