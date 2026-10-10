import { randomUUID } from "node:crypto"
import { db, sql } from "@klipstack/db"
import { stopBoss } from "@klipstack/queue"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"
import { authorizeAdmin } from "~/lib/admin.server"
import { dashboardUrl } from "~/lib/env.server"
import { adminFixtures } from "~/test/admin-fixtures"
import {
	OPERATIONS_LINKS,
	overview,
	readWorkerStatus,
	systemStatus,
	workerState,
} from "./admin-system.server"

const fx = adminFixtures("admin-system")
const instance = randomUUID()
afterEach(() => vi.restoreAllMocks())
afterAll(async () => {
	await db.execute(sql`delete from worker_heartbeats where instance_id = ${instance}`)
	await fx.cleanup()
	await stopBoss()
})

describe("worker state", () => {
	it("is recent up to 90 seconds, stale after, unknown without a report", () => {
		expect(workerState(0)).toBe("recent")
		expect(workerState(90)).toBe("recent")
		expect(workerState(90.001)).toBe("stale")
		expect(workerState(86_400)).toBe("stale")
		expect(workerState(null)).toBe("unknown")
		expect(workerState(Number.NaN)).toBe("unknown")
	})

	it("reads the newest heartbeat with the database's clock: an idle, live worker is recent", async () => {
		// Far in the future, so this row is the newest whatever else the database holds.
		await db.execute(sql`
			insert into worker_heartbeats (instance_id, started_at, last_seen_at)
			values (${instance}, now() - interval '3 days', now() + interval '1 hour')`)
		await db.execute(
			sql`update worker_heartbeats set last_seen_at = now() - interval '10 seconds' where instance_id = ${instance}
				and not exists (select 1 from worker_heartbeats w where w.last_seen_at > now() - interval '10 seconds' and w.instance_id <> ${instance})`,
		)
		const status = await readWorkerStatus()
		expect(status.state).toBe("recent")
		expect(status.lastSeenAt).not.toBeNull()
	})
})

describe("system status and overview", () => {
	it("reports the build, the storage mode and dashboard links, with no secret in them", async () => {
		const admin = await fx.account({ role: "admin" })
		const status = await systemStatus(await authorizeAdmin(await admin.session()))
		expect(status.database.ok).toBe(true)
		expect(["fs", "s3"]).toContain(status.deployment.storage)
		expect(status.deployment.version).toBeTruthy()
		for (const link of Object.values(OPERATIONS_LINKS)) {
			const url = new URL(link)
			expect(url.protocol).toBe("https:")
			expect(url.search).toBe("")
			expect(link).not.toMatch(/heartbeat\/[A-Za-z0-9]{8,}|token|key=/i)
		}
		expect(JSON.stringify(status)).not.toMatch(/S3_SECRET|BETTER_AUTH_SECRET|postgres:\/\//)
	})

	it("accepts only plain https dashboards as configured links, never a heartbeat ping URL", () => {
		const ok = (value: string) => dashboardUrl.safeParse(value).success
		expect(ok("https://uptime.betterstack.com/team/t1234/monitors")).toBe(true)
		expect(ok("http://uptime.betterstack.com/team/t1234/monitors")).toBe(false)
		expect(ok("https://uptime.betterstack.com/api/v1/heartbeat/abcDEF123456")).toBe(false)
		expect(ok("https://uptime.betterstack.com/team/t1234?token=abc")).toBe(false)
		expect(ok("https://user:pass@uptime.betterstack.com/")).toBe(false)
		expect(ok("javascript:alert(1)")).toBe(false)
		expect(ok("not a url")).toBe(false)
	})

	it("shows an unavailable state, never zeros, when a query fails", async () => {
		const admin = await fx.account({ role: "admin" })
		const ctx = await authorizeAdmin(await admin.session())
		vi.spyOn(console, "warn").mockImplementation(() => undefined)
		vi.spyOn(db, "execute").mockRejectedValue(new Error("connection refused"))
		const [page, system] = await Promise.all([overview(ctx), systemStatus(ctx)])
		expect(page.counts).toEqual({ ok: false })
		expect(page.queues).toEqual({ ok: false })
		expect(system.database).toEqual({ ok: false })
		expect(system.worker).toEqual({ ok: false })
	})
})
