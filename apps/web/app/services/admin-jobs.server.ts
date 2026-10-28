import { db, notifyDocumentEvent, sql } from "@klipstack/db"
import { admitExtract, admitImages, getBoss, QUEUES, type QueueName } from "@klipstack/queue"
import { fromDrizzle } from "pg-boss"
import {
	ADMIN_LIMITS,
	ADMIN_PAGE_SIZE,
	type AdminContext,
	adminMutation,
	assertAdminContext,
	auditActor,
	checkAdminLimit,
} from "~/lib/admin.server"
import { AppError, notFound } from "~/lib/app-error"
import { recordAudit } from "./admin-audit.server"
import { decodeCursor, encodeCursor } from "./admin-cursor.server"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const QUEUE_NAMES = new Set<string>(Object.values(QUEUES))

/** Error categories that are safe to show. Anything else, messages and stacks included, is "unknown". */
const EXTRACT_CODES = new Set([
	"invalid_url",
	"blocked_host",
	"fetch_failed",
	"timeout",
	"http_error",
	"not_html",
	"too_large",
	"too_many_redirects",
	"no_content",
	"bot_check",
	"not_feed",
	"unknown",
])

/** `documents.failure_reason` is a code, or `http_error:<status>`. Never trust it to stay one. */
export function documentErrorCategory(reason: string | null): string {
	if (!reason) return "unknown"
	const [code, status] = reason.split(":")
	if (!code || !EXTRACT_CODES.has(code)) return "unknown"
	return status && /^\d{3}$/.test(status) ? `${code}:${status}` : code
}

/** A failed job's output is the raw exception. Only a known code or a timeout gets a name. */
export function jobErrorCategory(output: { code?: unknown; message?: unknown } | null): string {
	if (output && typeof output.code === "string" && EXTRACT_CODES.has(output.code))
		return output.code
	if (output && typeof output.message === "string" && /timeout|expired/i.test(output.message))
		return "timeout"
	return "unknown"
}

export interface FailedDocument {
	documentId: string
	ownerId: string
	category: string
	createdAt: string
	failedAt: string
}

/** What came of the newest later job for the same version: queued, running, done, or skipped. */
export type FollowUp =
	| { state: "queued" | "active" | "failed" }
	| { state: "completed"; outcome: "completed" | "skipped" | "unknown" }

export interface FailedJob {
	jobId: string
	queue: string
	ownerId: string | null
	documentId: string | null
	versionId: string | null
	category: string
	attempts: number
	createdAt: string
	failedAt: string | null
	/** Image jobs only: still the live document's current version, with its images not done. */
	retryable: boolean
	followUp: FollowUp | null
}

/**
 * Extraction marks the document failed and returns, so pg-boss records a success: this list reads
 * the documents, not the queue.
 */
export async function listFailedDocuments(
	ctx: AdminContext,
	{ cursor }: { cursor?: string | null },
): Promise<{ documents: FailedDocument[]; nextCursor: string | null }> {
	assertAdminContext(ctx)
	const after = decodeCursor(cursor)
	const result = await db.execute<{
		id: string
		user_id: string
		failure_reason: string | null
		created_at: Date
		updated_at: Date
		cursor_at: string
	}>(sql`
		select d.id, d.user_id, d.failure_reason, d.created_at, d.updated_at,
			d.updated_at::text as cursor_at
		from documents d
		where d.status = 'failed' and d.deleted_at is null
			${after ? sql`and (d.updated_at, d.id) < (${after.at}::timestamptz, ${after.id}::uuid)` : sql``}
		order by d.updated_at desc, d.id desc
		limit ${ADMIN_PAGE_SIZE + 1}
	`)
	const rows = result.rows.slice(0, ADMIN_PAGE_SIZE)
	const last = rows.at(-1)
	return {
		documents: rows.map((row) => ({
			documentId: row.id,
			ownerId: row.user_id,
			category: documentErrorCategory(row.failure_reason),
			createdAt: new Date(row.created_at).toISOString(),
			failedAt: new Date(row.updated_at).toISOString(),
		})),
		nextCursor:
			result.rows.length > ADMIN_PAGE_SIZE && last
				? encodeCursor({ at: last.cursor_at, id: last.id })
				: null,
	}
}

/**
 * Failed jobs pg-boss still retains (a rolling window, not an incident archive). Reads named
 * columns of its job table and never writes to it. Payloads and outputs stay on the server: the
 * payload's IDs are resolved to an owner here, and the output is reduced to a category.
 */
export async function listFailedJobs(
	ctx: AdminContext,
	{ cursor }: { cursor?: string | null },
): Promise<{ jobs: FailedJob[]; nextCursor: string | null }> {
	assertAdminContext(ctx)
	await getBoss()
	const after = decodeCursor(cursor)
	const result = await db.execute<{
		id: string
		name: string
		retry_count: number
		created_on: Date
		completed_on: Date | null
		error_code: string | null
		error_message: string | null
		document_id: string | null
		version_id: string | null
		owner_id: string | null
		retryable: boolean
		follow_state: string | null
		follow_outcome: string | null
		cursor_at: string
	}>(sql`
		select j.id, j.name, j.retry_count, j.created_on, j.completed_on,
			j.output->>'code' as error_code, j.output->>'message' as error_message,
			coalesce(d.id, vd.id) as document_id, v.id as version_id,
			coalesce(d.user_id, vd.user_id, eu.id) as owner_id,
			(j.name = ${QUEUES.images} and vd.id is not null and vd.deleted_at is null
				and vd.current_version_id = v.id and not v.images_done) as retryable,
			f.state::text as follow_state, f.output->>'outcome' as follow_outcome,
			j.created_on::text as cursor_at
		from pgboss.job j
		left join documents d
			on j.name = ${QUEUES.extract} and d.id::text = j.data->>'documentId'
		left join document_versions v
			on j.name = ${QUEUES.images} and v.id::text = j.data->>'versionId'
		left join documents vd on vd.id = v.document_id
		left join "user" eu on j.name = ${QUEUES.export} and eu.id = j.data->>'userId'
		left join lateral (
			select n.state, n.output from pgboss.job n
			where n.name = j.name and j.name = ${QUEUES.images}
				and n.data->>'versionId' = j.data->>'versionId'
				and n.created_on > j.created_on
			order by n.created_on desc limit 1
		) f on true
		where j.state = 'failed'
			${after ? sql`and (j.created_on, j.id) < (${after.at}::timestamptz, ${after.id}::uuid)` : sql``}
		order by j.created_on desc, j.id desc
		limit ${ADMIN_PAGE_SIZE + 1}
	`)
	const rows = result.rows.slice(0, ADMIN_PAGE_SIZE)
	const last = rows.at(-1)
	return {
		jobs: rows.map((row) => ({
			jobId: row.id,
			queue: QUEUE_NAMES.has(row.name) ? row.name : "other",
			ownerId: row.owner_id,
			documentId: row.document_id,
			versionId: row.version_id,
			category: jobErrorCategory({ code: row.error_code, message: row.error_message }),
			attempts: row.retry_count + 1,
			createdAt: new Date(row.created_on).toISOString(),
			failedAt: row.completed_on ? new Date(row.completed_on).toISOString() : null,
			retryable: row.retryable === true,
			followUp: followUp(row.follow_state, row.follow_outcome),
		})),
		nextCursor:
			result.rows.length > ADMIN_PAGE_SIZE && last
				? encodeCursor({ at: last.cursor_at, id: last.id })
				: null,
	}
}

function followUp(state: string | null, outcome: string | null): FollowUp | null {
	if (!state) return null
	if (state === "created" || state === "retry") return { state: "queued" }
	if (state === "active") return { state: "active" }
	if (state === "completed")
		return {
			state: "completed",
			outcome: outcome === "completed" || outcome === "skipped" ? outcome : "unknown",
		}
	return { state: "failed" }
}

export interface QueueSummary {
	queue: QueueName
	queued: number
	active: number
	/** Failed jobs pg-boss still retains, not a lifetime total. */
	failedRetained: number
	oldestQueuedSeconds: number | null
	oldestActiveSeconds: number | null
}

export async function queueSummary(ctx: AdminContext): Promise<QueueSummary[]> {
	assertAdminContext(ctx)
	await getBoss()
	const result = await db.execute<{
		name: string
		queued: number
		active: number
		failed: number
		oldest_queued: number | null
		oldest_active: number | null
	}>(sql`
		select name,
			count(*) filter (where state in ('created', 'retry'))::int as queued,
			count(*) filter (where state = 'active')::int as active,
			count(*) filter (where state = 'failed')::int as failed,
			extract(epoch from now() - min(created_on) filter (where state in ('created', 'retry') and start_after <= now()))::int as oldest_queued,
			extract(epoch from now() - min(started_on) filter (where state = 'active'))::int as oldest_active
		from pgboss.job
		group by name
	`)
	const byName = new Map(result.rows.map((row) => [row.name, row]))
	return Object.values(QUEUES).map((queue) => {
		const row = byName.get(queue)
		return {
			queue,
			queued: row?.queued ?? 0,
			active: row?.active ?? 0,
			failedRetained: row?.failed ?? 0,
			oldestQueuedSeconds: row?.oldest_queued ?? null,
			oldestActiveSeconds: row?.oldest_active ?? null,
		}
	})
}

export type RetryTarget =
	| { kind: "extract"; documentId: string }
	| { kind: "images"; jobId: string }

const NOT_QUEUED = {
	not_failed: "This is not in a failed state any more.",
	already_pending: "This work is already queued or running.",
	trashed: "The article is in the trash.",
	superseded: "The article has a newer version. This job cannot be retried.",
	already_done: "A later attempt already finished the images.",
} as const

/** Why a retry was not queued, as a refusal. */
const notQueued = (reason: string) =>
	reason in NOT_QUEUED
		? new AppError(reason as keyof typeof NOT_QUEUED, NOT_QUEUED[reason as keyof typeof NOT_QUEUED])
		: new AppError("not_failed", `Not queued: ${reason}.`)

/**
 * Admits one retry. The payload is rebuilt from the database: the browser names a document or a
 * failed job, never an owner, a queue or a payload. The job, the document's state and the audit
 * event commit together; the returned job ID means "queued", not "done".
 */
export async function retryJob(ctx: AdminContext, target: RetryTarget): Promise<{ jobId: string }> {
	if (!UUID.test(target.kind === "extract" ? target.documentId : target.jobId))
		throw new AppError("invalid_request", "Name a document or a failed job.")
	const admitted = await adminMutation(ctx, async (tx) => {
		await checkAdminLimit(tx, ADMIN_LIMITS.retry, ctx.userId)
		await checkAdminLimit(tx, ADMIN_LIMITS.retryGlobal, "all")
		if (target.kind === "extract") {
			const result = await admitExtract(tx, target.documentId, "failed")
			if (result.outcome === "missing") throw notFound("No such document.")
			if (result.outcome !== "admitted") throw notQueued(result.outcome)
			await recordAudit(tx, {
				actor: auditActor(ctx),
				action: "job.retry.extract",
				targetKind: "document",
				targetId: target.documentId,
				correlationId: ctx.correlationId,
				metadata: {
					documentId: target.documentId,
					ownerId: result.userId,
					jobId: result.jobId,
				},
			})
			return { jobId: result.jobId, userId: result.userId, documentId: target.documentId }
		}

		// Looked up in the images queue only: an ID from another queue is simply not found.
		const boss = await getBoss()
		const [job] = await boss.findJobs<{ versionId?: unknown }>(QUEUES.images, {
			id: target.jobId,
			db: fromDrizzle(tx, sql),
		})
		if (!job) throw notFound("No such job.")
		if (job.state !== "failed") throw notQueued("not_failed")
		const versionId = job.data?.versionId
		if (typeof versionId !== "string" || !UUID.test(versionId)) throw notQueued("superseded")
		const result = await admitImages(tx, versionId)
		if (result.outcome !== "admitted")
			throw notQueued(result.outcome === "missing" ? "superseded" : result.outcome)
		await recordAudit(tx, {
			actor: auditActor(ctx),
			action: "job.retry.images",
			targetKind: "job",
			targetId: target.jobId,
			correlationId: ctx.correlationId,
			metadata: {
				sourceJobId: target.jobId,
				jobId: result.jobId,
				versionId,
				documentId: result.documentId,
				ownerId: result.userId,
			},
		})
		return { jobId: result.jobId, userId: null, documentId: result.documentId }
	})
	// After the commit, to the owner's open tabs. Image work reports itself when it finishes.
	if (admitted.userId)
		await notifyDocumentEvent({
			userId: admitted.userId,
			documentId: admitted.documentId,
			kind: "queued",
		})
	return { jobId: admitted.jobId }
}
