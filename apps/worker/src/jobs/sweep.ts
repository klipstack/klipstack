import { db, notifyDocumentEvent, sql } from "@klipstack/db"
import { QUEUES } from "@klipstack/queue"
import { log } from "../log"

export async function handleSweep() {
	const settled = await settleStuckExtractions()
	if (settled.length > 0)
		log.warn("sweep: settled extractions whose job was gone", { count: settled.length })
}

/**
 * Live articles still queued or processing with no extraction job waiting or running: pg-boss
 * failed the job after a timeout or a crash on its last attempt, so the handler never recorded
 * the outcome. They become failed, or stay readable when they have a version, as the extract job
 * does. Trashed ones wait: restoring an article queues its work again.
 *
 * A job admitted while this runs may be missed by it, and the article marked failed for a moment:
 * that job still runs, and publishing sets the status again. `owners` limits it to those users'
 * articles (tests).
 */
export async function settleStuckExtractions(owners?: string[]): Promise<string[]> {
	const { rows } = await db.execute<{ id: string; user_id: string; status: string }>(sql`
		update documents d
		set status = case when d.current_version_id is null then 'failed' else 'ready' end,
			failure_reason = 'timeout'
		where d.status in ('queued', 'processing')
			and d.deleted_at is null
			and ${owners ? sql`d.user_id in ${owners}` : sql`true`}
			and not exists (
				select 1 from pgboss.job j
				where j.name = ${QUEUES.extract}
					and j.data->>'documentId' = d.id::text
					and j.state in ('created', 'retry', 'active')
			)
		returning d.id, d.user_id, d.status`)
	for (const row of rows)
		await notifyDocumentEvent({
			userId: row.user_id,
			documentId: row.id,
			kind: row.status === "failed" ? "failed" : "ready",
		})
	return rows.map((row) => row.id)
}
