import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { eq } from "drizzle-orm"
import type pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createMigrationPool, createPool, db, pool, setDatabaseProcess } from "./client"
import { user } from "./schema"

const execFileAsync = promisify(execFile)
const userId = `test-timeouts-${randomUUID()}`
const pools: pg.Pool[] = []

/** A pool with limits short enough for a test to cross them. */
function shortPool(timeouts: Partial<Parameters<typeof createPool>[0]["timeouts"]> = {}, max = 2) {
	const made = createPool({
		max,
		timeouts: {
			connectMs: 500,
			statementMs: 300,
			lockMs: 300,
			idleInTransactionMs: 300,
			...timeouts,
		},
	})
	pools.push(made)
	return made
}

async function settings(target: pg.Pool) {
	const result = await target.query<{ name: string; setting: string }>(
		`select name, setting from pg_settings
		where name in ('statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout')
		order by name`,
	)
	return Object.fromEntries(result.rows.map((row) => [row.name, row.setting]))
}

beforeAll(async () => {
	await db.insert(user).values({ id: userId, name: "Timeouts", email: `${userId}@example.com` })
})
afterAll(async () => {
	await Promise.all(pools.map((p) => p.end()))
	await db.delete(user).where(eq(user.id, userId))
	await pool.end()
})

describe("the process pool", () => {
	it("gives every connection the web limits, and waits at most 10 s for a connection", async () => {
		expect(await settings(pool)).toEqual({
			idle_in_transaction_session_timeout: "30000",
			lock_timeout: "5000",
			statement_timeout: "15000",
		})
		expect(pool.options.connectionTimeoutMillis).toBe(10_000)
	})

	it("gives the worker's connections its longer statement limit", async () => {
		const worker = shortPool()
		setDatabaseProcess("worker", worker)
		expect(worker.options.connectionTimeoutMillis).toBe(10_000)
		expect(await settings(worker)).toEqual({
			idle_in_transaction_session_timeout: "30000",
			lock_timeout: "5000",
			statement_timeout: "300000",
		})
	})

	it("refuses to change the limits once connections are open", async () => {
		const opened = shortPool()
		await opened.query("select 1")
		expect(() => setDatabaseProcess("worker", opened)).toThrow("before the first query")
	})
})

describe("the limits", () => {
	it("cancels a statement that runs past the statement timeout", async () => {
		const started = Date.now()
		await expect(shortPool().query("select pg_sleep(5)")).rejects.toMatchObject({
			code: "57014",
			message: "canceling statement due to statement timeout",
		})
		expect(Date.now() - started).toBeLessThan(3000)
	})

	it("gives up on a row lock held longer than the lock timeout", async () => {
		const short = shortPool({ statementMs: 0, idleInTransactionMs: 0 })
		const holder = await short.connect()
		try {
			await holder.query("begin")
			await holder.query("select id from public.user where id = $1 for update", [userId])
			await expect(
				short.query("select id from public.user where id = $1 for update", [userId]),
			).rejects.toMatchObject({
				code: "55P03",
				message: expect.stringContaining("lock timeout"),
			})
		} finally {
			await holder.query("rollback")
			holder.release()
		}
	})

	it("ends a transaction left open, without taking the process down, and the pool recovers", async () => {
		const short = shortPool()
		const client = await short.connect()
		await client.query("begin")
		// Waits for the server to end the session: the point is that time passes.
		await new Promise((resolve) => setTimeout(resolve, 1000))
		await expect(client.query("select 1")).rejects.toThrow()
		client.release()
		expect((await short.query<{ one: number }>("select 1 as one")).rows).toEqual([{ one: 1 }])
	})

	it("fails a request for a connection once all are taken for longer than the connect timeout", async () => {
		const short = shortPool({}, 1)
		const held = await short.connect()
		try {
			const started = Date.now()
			await expect(short.query("select 1")).rejects.toThrow(
				"timeout exceeded when trying to connect",
			)
			expect(Date.now() - started).toBeLessThan(3000)
		} finally {
			held.release()
		}
	})
})

describe("the exemptions", () => {
	it("runs migrations without the app's limits, whatever the environment says", async () => {
		const env = { ...process.env }
		Object.assign(process.env, {
			PG_CONNECT_TIMEOUT_MS: "1",
			PG_STATEMENT_TIMEOUT_MS: "1",
			PG_LOCK_TIMEOUT_MS: "1",
			PG_IDLE_IN_TRANSACTION_TIMEOUT_MS: "1",
		})
		try {
			const migrations = createMigrationPool()
			pools.push(migrations)
			expect(migrations.options.connectionTimeoutMillis).toBeUndefined()
			expect(await settings(migrations)).toEqual({
				idle_in_transaction_session_timeout: "0",
				lock_timeout: "0",
				statement_timeout: "0",
			})
			await expect(migrations.query("select pg_sleep(0.05)")).resolves.toMatchObject({
				rowCount: 1,
			})
		} finally {
			process.env = env
		}
	})

	it("has migrate use that pool: it runs with a 1 ms connect limit in the environment", async () => {
		// A 1 ms limit on getting a connection fails any pool that has it: connecting takes longer.
		const run = await execFileAsync("pnpm", ["exec", "tsx", "src/migrate.ts"], {
			cwd: fileURLToPath(new URL("..", import.meta.url)),
			env: { ...process.env, PG_CONNECT_TIMEOUT_MS: "1" },
		})
		expect(run.stdout).toContain("migrations applied")
	}, 30_000)
})
