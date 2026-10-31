import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { config } from "dotenv"

/**
 * Load the repo-root `.env` regardless of which workspace package is the cwd.
 * Walks up from cwd until it finds a `pnpm-workspace.yaml`.
 */
export function loadEnv() {
	let dir = process.cwd()
	for (let i = 0; i < 6; i++) {
		if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) {
			config({ path: resolve(dir, ".env"), quiet: true })
			return
		}
		const parent = dirname(dir)
		if (parent === dir) break
		dir = parent
	}
	config({ quiet: true })
}

/** The pool size: PG_POOL_MAX, a whole number of at least 1 (default 10). */
export function poolMax(env: Record<string, string | undefined> = process.env): number {
	const raw = env.PG_POOL_MAX
	if (raw === undefined || raw === "") return 10
	const max = Number(raw)
	if (!Number.isInteger(max) || max < 1)
		throw new Error(`PG_POOL_MAX must be a whole number of at least 1, not "${raw}"`)
	return max
}

/** The processes that open a pool: they differ in how long a statement may run. */
export type DbProcess = "web" | "worker"

/** How long the database may make a process wait, in milliseconds; 0 means no limit. */
export interface DbTimeouts {
	/** For a connection from the pool: all in use, or the server slow to answer. */
	connectMs: number
	/** For one statement. */
	statementMs: number
	/** For a lock another transaction holds. */
	lockMs: number
	/** For a transaction left open with nothing running: the server ends the session. */
	idleInTransactionMs: number
}

function milliseconds(
	env: Record<string, string | undefined>,
	name: string,
	fallback: number,
): number {
	const raw = env[name]
	if (raw === undefined || raw === "") return fallback
	const value = Number(raw)
	if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value))
		throw new Error(`${name} must be a whole number of milliseconds (0 for no limit), not "${raw}"`)
	return value
}

/**
 * The database limits for a process. Web requests get 15 s per statement; the worker's jobs
 * (purge, feeds, topics) 5 minutes. Every setting is checked in both processes, so a wrong value
 * stops either at start.
 */
export function dbTimeouts(
	process: DbProcess,
	env: Record<string, string | undefined> = globalThis.process.env,
): DbTimeouts {
	const web = milliseconds(env, "PG_STATEMENT_TIMEOUT_MS", 15_000)
	const worker = milliseconds(env, "PG_WORKER_STATEMENT_TIMEOUT_MS", 300_000)
	return {
		connectMs: milliseconds(env, "PG_CONNECT_TIMEOUT_MS", 10_000),
		statementMs: process === "worker" ? worker : web,
		lockMs: milliseconds(env, "PG_LOCK_TIMEOUT_MS", 5_000),
		idleInTransactionMs: milliseconds(env, "PG_IDLE_IN_TRANSACTION_TIMEOUT_MS", 30_000),
	}
}

/** The server-side limits as a connection's startup options (pg's `options`). */
export function sessionOptions(
	timeouts: Partial<Pick<DbTimeouts, "statementMs" | "lockMs" | "idleInTransactionMs">>,
): string {
	const settings: [string, number | undefined][] = [
		["statement_timeout", timeouts.statementMs],
		["lock_timeout", timeouts.lockMs],
		["idle_in_transaction_session_timeout", timeouts.idleInTransactionMs],
	]
	return settings
		.filter(([, value]) => value !== undefined)
		.map(([name, value]) => `-c ${name}=${value}`)
		.join(" ")
}

export function databaseUrl(): string {
	const url = process.env.DATABASE_URL
	if (!url) throw new Error("DATABASE_URL is not set")
	return url
}
