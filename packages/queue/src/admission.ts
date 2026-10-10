import {
	and,
	documentRaw,
	documents,
	documentVersions,
	eq,
	notExists,
	sql,
	type Tx,
} from "@klipstack/db"
import { fromDrizzle, type SendOptions } from "pg-boss"
import { getBoss } from "./boss"
import { type JobPayloads, QUEUES, type QueueName } from "./jobs"

/**
 * Admission: the one place that decides whether extraction or image work may be queued. Every
 * producer (saving, the user's retry, the admin retry, the re-extract script, the worker) calls it
 * inside its own transaction, so the job, the document's state and any audit row commit together.
 *
 * The queues use pg-boss's `standard` policy, where `singletonKey` alone does not deduplicate.
 * Deduplication is the document row lock taken here plus a look at the jobs already waiting.
 */

/** Sends through the caller's transaction: the job exists only if that transaction commits. */
export async function sendInTransaction<Q extends QueueName>(
	tx: Tx,
	queue: Q,
	payload: JobPayloads[Q],
	options: SendOptions = {},
): Promise<string> {
	const boss = await getBoss()
	const id = await boss.send(queue, payload, { ...options, db: fromDrizzle(tx, sql) })
	if (!id) throw new Error(`pg-boss refused a ${queue} job`)
	return id
}

type PendingState = "created" | "retry" | "active"

async function pendingStates(
	tx: Tx,
	queue: QueueName,
	data: Record<string, string>,
): Promise<Set<PendingState>> {
	const boss = await getBoss()
	const jobs = await boss.findJobs(queue, { data, db: fromDrizzle(tx, sql) })
	const states = new Set<PendingState>()
	for (const job of jobs)
		if (job.state === "created" || job.state === "retry" || job.state === "active")
			states.add(job.state)
	return states
}

export type ExtractAdmissionMode =
	/** A retry: only a document whose extraction failed. */
	| "failed"
	/** Run again whatever the status, unless work is already waiting or running. */
	| "refresh"
	/** A new capture was stored: run again unless a job that has not started will pick it up. */
	| "capture"

export type ExtractAdmission =
	| { outcome: "admitted"; jobId: string; userId: string }
	| { outcome: "missing" | "trashed" | "not_failed" | "already_pending"; userId?: string }

/**
 * Locks the document, checks it against `mode`, and queues extraction with `status = queued`.
 * Two callers at once (two tabs, two admins, an admin and the owner) get one admission: the second
 * waits for the row lock, then sees the first one's job.
 */
export async function admitExtract(
	tx: Tx,
	documentId: string,
	mode: ExtractAdmissionMode,
): Promise<ExtractAdmission> {
	const [doc] = await tx
		.select({
			userId: documents.userId,
			status: documents.status,
			deletedAt: documents.deletedAt,
		})
		.from(documents)
		.where(eq(documents.id, documentId))
		.for("update")
	if (!doc) return { outcome: "missing" }
	const { userId } = doc
	if (doc.deletedAt) return { outcome: "trashed", userId }
	if (mode === "failed" && doc.status !== "failed") return { outcome: "not_failed", userId }

	const pending = await pendingStates(tx, QUEUES.extract, { documentId })
	// A job that has not started reads the newest capture. A failed document's job may still be
	// `active` for a moment (the handler marks the failure, then returns): it does not count.
	// A running job that read an older capture publishes nothing once a newer one exists: the
	// worker checks that under this same row lock (apps/worker/src/jobs/extract.ts).
	const waiting = pending.has("created") || pending.has("retry")
	if (waiting || (mode === "refresh" && pending.has("active")))
		return { outcome: "already_pending", userId }

	// A retry fetches the page again: the copy the server fetched is what failed (a script-only
	// shell, a bot check), and the job would read it back. Captures from the extension or the API
	// stay; so does any copy a version was made from.
	if (mode === "failed")
		await tx
			.delete(documentRaw)
			.where(
				and(
					eq(documentRaw.documentId, documentId),
					eq(documentRaw.source, "fetch"),
					notExists(
						tx
							.select({ id: documentVersions.id })
							.from(documentVersions)
							.where(eq(documentVersions.rawId, documentRaw.id)),
					),
				),
			)
	await tx
		.update(documents)
		.set({ status: "queued", failureReason: null })
		.where(eq(documents.id, documentId))
	const jobId = await sendInTransaction(tx, QUEUES.extract, { documentId })
	return { outcome: "admitted", jobId, userId }
}

export type ImagesAdmission =
	| { outcome: "admitted"; jobId: string; userId: string; documentId: string }
	| {
			outcome: "missing" | "trashed" | "superseded" | "already_done" | "already_pending"
			userId?: string
			documentId?: string
	  }

/**
 * Queues image work for a version only while it is the live document's current version and its
 * images are not done. The worker checks the same things again when it starts and when it
 * publishes: admission does not promise the version stays eligible.
 */
export async function admitImages(tx: Tx, versionId: string): Promise<ImagesAdmission> {
	const [version] = await tx
		.select({ documentId: documentVersions.documentId })
		.from(documentVersions)
		.where(eq(documentVersions.id, versionId))
	if (!version) return { outcome: "missing" }
	const { documentId } = version
	const [doc] = await tx
		.select({
			userId: documents.userId,
			deletedAt: documents.deletedAt,
			currentVersionId: documents.currentVersionId,
		})
		.from(documents)
		.where(eq(documents.id, documentId))
		.for("update")
	if (!doc) return { outcome: "missing" }
	const { userId } = doc
	if (doc.deletedAt) return { outcome: "trashed", userId, documentId }
	if (doc.currentVersionId !== versionId) return { outcome: "superseded", userId, documentId }
	// Read after the lock: a publication that held it has committed by now.
	const [current] = await tx
		.select({ imagesDone: documentVersions.imagesDone })
		.from(documentVersions)
		.where(eq(documentVersions.id, versionId))
	if (!current) return { outcome: "missing", userId, documentId }
	if (current.imagesDone) return { outcome: "already_done", userId, documentId }

	const pending = await pendingStates(tx, QUEUES.images, { versionId })
	if (pending.size > 0) return { outcome: "already_pending", userId, documentId }
	const jobId = await sendInTransaction(tx, QUEUES.images, { versionId })
	return { outcome: "admitted", jobId, userId, documentId }
}
