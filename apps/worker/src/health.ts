import { stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * The worker's health, for the container's health check (`node --import tsx src/healthcheck.ts`).
 * The worker has no HTTP server, so it renews a file each time its heartbeat reaches the
 * database, and the check reads the file's age. A stale file means the event loop is stuck, the
 * database is out of reach, or the worker never finished starting.
 */
export const HEALTH_FILE =
	process.env.WORKER_HEALTH_FILE || join(tmpdir(), "klipstack-worker-alive")

/**
 * Three heartbeats (HEARTBEAT_INTERVAL_MS, 30 s): one slow write or one missed tick is not a
 * failure. Not imported from heartbeat.ts: the check must not load the database module.
 */
export const HEALTH_MAX_AGE_MS = 90_000

export async function markAlive(file = HEALTH_FILE, now = new Date()): Promise<void> {
	try {
		await utimes(file, now, now)
	} catch {
		// `wx`: create only, so a link someone left at this path is never written through.
		await writeFile(file, "", { flag: "wx" })
		await utimes(file, now, now)
	}
}

/** Healthy when the file was renewed within `maxAgeMs`; otherwise the reason it is not. */
export async function checkHealth(
	file = HEALTH_FILE,
	{ now = Date.now(), maxAgeMs = HEALTH_MAX_AGE_MS } = {},
): Promise<{ ok: true } | { ok: false; reason: string }> {
	let mtimeMs: number
	try {
		;({ mtimeMs } = await stat(file))
	} catch {
		return { ok: false, reason: `no heartbeat yet (${file} missing)` }
	}
	const age = now - mtimeMs
	if (age > maxAgeMs) return { ok: false, reason: `last heartbeat ${Math.round(age / 1000)}s ago` }
	return { ok: true }
}
