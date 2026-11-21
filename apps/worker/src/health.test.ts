import { spawnSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { checkHealth, HEALTH_MAX_AGE_MS, markAlive } from "./health"
import { HEARTBEAT_INTERVAL_MS, startHeartbeat } from "./heartbeat"

let dir: string
beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "worker-health-"))
})
afterAll(async () => {
	await rm(dir, { recursive: true, force: true })
})

describe("the worker's health", () => {
	it("is unhealthy before the first heartbeat", async () => {
		expect(await checkHealth(join(dir, "never"))).toMatchObject({ ok: false })
	})

	it("is healthy for three heartbeats after one, then not", async () => {
		const file = join(dir, "beat")
		const at = new Date("2026-11-21T10:00:00Z")
		await markAlive(file, at)
		await markAlive(file, at) // renewing an existing file
		const after = (ms: number) => checkHealth(file, { now: at.getTime() + ms })
		expect(await after(HEALTH_MAX_AGE_MS)).toEqual({ ok: true })
		expect(await after(HEALTH_MAX_AGE_MS + 1_000)).toMatchObject({ ok: false })
		expect(HEALTH_MAX_AGE_MS).toBe(3 * HEARTBEAT_INTERVAL_MS)
	})

	it("is renewed only by heartbeats that reached the database", async () => {
		const onBeat = vi.fn(async () => undefined)
		const write = vi.fn(async () => {
			throw new Error("database down")
		})
		const failing = startHeartbeat({ intervalMs: 60_000, write, onBeat })
		await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1))
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(onBeat).not.toHaveBeenCalled()
		failing()
		const working = startHeartbeat({ intervalMs: 60_000, write: async () => undefined, onBeat })
		await vi.waitFor(() => expect(onBeat).toHaveBeenCalledTimes(1))
		working()
	})

	it("is what the container's check script reports, without a database", () => {
		const check = (file: string) =>
			spawnSync(process.execPath, ["--import", "tsx", "src/healthcheck.ts"], {
				cwd: new URL("..", import.meta.url).pathname,
				// No DATABASE_URL: the check must not need one.
				env: { PATH: process.env.PATH, WORKER_HEALTH_FILE: file },
				encoding: "utf8",
			})
		const missing = check(join(dir, "missing"))
		expect(missing.status).toBe(1)
		expect(missing.stderr).toContain("worker unhealthy")
	})

	it("passes the check script with a fresh file", async () => {
		const file = join(dir, "fresh")
		await markAlive(file)
		const result = spawnSync(process.execPath, ["--import", "tsx", "src/healthcheck.ts"], {
			cwd: new URL("..", import.meta.url).pathname,
			env: { PATH: process.env.PATH, WORKER_HEALTH_FILE: file },
			encoding: "utf8",
		})
		expect(result.stderr).toBe("")
		expect(result.status).toBe(0)
	})
})
