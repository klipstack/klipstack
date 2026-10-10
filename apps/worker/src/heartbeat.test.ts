import { randomUUID } from "node:crypto"
import { db, eq, sql, workerHeartbeats } from "@klipstack/db"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"
import { startHeartbeat, writeHeartbeat } from "./heartbeat"
import { purgeAdminRecords } from "./jobs/purge"

const ids: string[] = []
afterEach(() => vi.useRealTimers())
afterAll(async () => {
	for (const id of ids) await db.delete(workerHeartbeats).where(eq(workerHeartbeats.instanceId, id))
})

describe("worker heartbeat", () => {
	it("keeps the start time and moves last-seen forward, by the database's clock", async () => {
		const id = randomUUID()
		ids.push(id)
		await writeHeartbeat(id)
		await db.execute(
			sql`update worker_heartbeats set started_at = now() - interval '1 hour', last_seen_at = now() - interval '1 hour' where instance_id = ${id}`,
		)
		await writeHeartbeat(id)
		const result = await db.execute<{ started: number; seen: number }>(sql`
			select extract(epoch from now() - started_at)::float as started,
				extract(epoch from now() - last_seen_at)::float as seen
			from worker_heartbeats where instance_id = ${id}`)
		expect(result.rows[0]!.started).toBeGreaterThan(3500)
		expect(result.rows[0]!.seen).toBeLessThan(5)
	})

	it("reports at once, then every interval, and retries after a failed write", async () => {
		vi.useFakeTimers()
		const write = vi
			.fn<(id: string) => Promise<void>>()
			.mockResolvedValueOnce()
			.mockRejectedValueOnce(new Error("database unavailable"))
			.mockResolvedValue()
		const stop = startHeartbeat({ instanceId: "i", intervalMs: 30_000, write })
		await vi.advanceTimersByTimeAsync(0)
		expect(write).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(30_000)
		await vi.advanceTimersByTimeAsync(30_000)
		expect(write).toHaveBeenCalledTimes(3)
		stop()
	})

	it("stops reporting on shutdown", async () => {
		vi.useFakeTimers()
		const write = vi.fn(async () => undefined)
		const stop = startHeartbeat({ instanceId: "i", intervalMs: 30_000, write })
		await vi.advanceTimersByTimeAsync(0)
		stop()
		await vi.advanceTimersByTimeAsync(120_000)
		expect(write).toHaveBeenCalledTimes(1)
	})

	it("does not start a second write while one is still waiting on the database", async () => {
		vi.useFakeTimers()
		const write = vi.fn(() => new Promise<void>(() => {}))
		const stop = startHeartbeat({ instanceId: "i", intervalMs: 30_000, write })
		await vi.advanceTimersByTimeAsync(90_000)
		expect(write).toHaveBeenCalledTimes(1)
		stop()
	})

	it("prunes rows of workers gone for over seven days, and audit events over ninety", async () => {
		const [gone, recent] = [randomUUID(), randomUUID()]
		ids.push(gone, recent)
		await writeHeartbeat(gone)
		await writeHeartbeat(recent)
		await db.execute(
			sql`update worker_heartbeats set last_seen_at = now() - interval '8 days' where instance_id = ${gone}`,
		)
		const marker = randomUUID()
		await db.execute(sql`
			insert into admin_audit_events (created_at, actor_kind, action, target_kind, target_id, correlation_id)
			values (now() - interval '91 days', 'operator-cli', 'role.grant', 'user', 'old', ${marker}),
				(now() - interval '89 days', 'operator-cli', 'role.grant', 'user', 'kept', ${marker})`)
		await purgeAdminRecords()
		const beats = await db.select().from(workerHeartbeats)
		expect(beats.map((b) => b.instanceId)).not.toContain(gone)
		expect(beats.map((b) => b.instanceId)).toContain(recent)
		const events = await db.execute<{ target_id: string }>(
			sql`select target_id from admin_audit_events where correlation_id = ${marker}`,
		)
		expect(events.rows.map((r) => r.target_id)).toEqual(["kept"])
		await db.execute(sql`delete from admin_audit_events where correlation_id = ${marker}`)
	})
})
