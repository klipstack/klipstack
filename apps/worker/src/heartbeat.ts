import { randomUUID } from "node:crypto"
import { db, sql } from "@klipstack/db"
import { log } from "./log"

export const HEARTBEAT_INTERVAL_MS = 30_000

/** Writes this process's row with the database's clock. Throws when the database is unavailable. */
export async function writeHeartbeat(instanceId: string): Promise<void> {
	await db.execute(sql`
		insert into worker_heartbeats (instance_id, started_at, last_seen_at)
		values (${instanceId}, now(), now())
		on conflict (instance_id) do update set last_seen_at = now()
	`)
}

/**
 * Reports process liveness for /admin/system: once now (call it after every consumer is
 * registered), then every 30 seconds. A failed write is logged and tried again on the next tick;
 * it never counts as a report. Returns a function that stops the timer (shutdown).
 */
export function startHeartbeat({
	instanceId = randomUUID(),
	intervalMs = HEARTBEAT_INTERVAL_MS,
	write = writeHeartbeat,
}: {
	instanceId?: string
	intervalMs?: number
	write?: (instanceId: string) => Promise<void>
} = {}): () => void {
	let busy = false
	const beat = async () => {
		// A write still waiting on a slow database: do not pile up behind it.
		if (busy) return
		busy = true
		try {
			await write(instanceId)
		} catch (error) {
			log.warn("heartbeat: write failed, will retry", { error })
		} finally {
			busy = false
		}
	}
	void beat()
	const timer = setInterval(() => void beat(), intervalMs)
	timer.unref()
	return () => clearInterval(timer)
}
