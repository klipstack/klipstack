import { logError } from "@klipstack/log"
import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"
import {
	databaseUrl,
	type DbProcess,
	type DbTimeouts,
	dbTimeouts,
	loadEnv,
	poolMax,
	sessionOptions,
	withSessionOptions,
} from "./env"
import * as schema from "./schema"

loadEnv()

declare global {
	var __klipstackPool: pg.Pool | undefined
}

/**
 * A pool whose connections carry the given limits. Without them, a slow query, a lock wait or a
 * transaction a bug left open holds its connection for good, and once all are held every request
 * waits forever, with nothing in the logs. `timeouts: null` sets none: for migrations.
 */
export function createPool({ max, timeouts }: { max: number; timeouts: DbTimeouts | null }) {
	const created = new pg.Pool({
		...withSessionOptions(databaseUrl(), timeouts ? sessionOptions(timeouts) : ""),
		max,
		...(timeouts && { connectionTimeoutMillis: timeouts.connectMs }),
	})
	// The server ends a session that sat in a transaction too long while the connection is checked
	// out and idle. pg then emits `error` on the client, and an `error` nobody listens for stops the
	// process. The next query on that client fails, and the request with it; this logs why.
	created.on("connect", (client) => {
		client.on("error", (error) => logError("[db] connection lost", error))
	})
	// The same error on a connection waiting in the pool: the listener above has logged it, and the
	// pool drops the connection.
	created.on("error", () => undefined)
	return created
}

/**
 * The pool `migrate` runs on, without the app's limits: a migration may rewrite a large table, or
 * wait for the app's transactions to let go of one. One connection, as drizzle's migrator uses.
 */
export function createMigrationPool() {
	return createPool({ max: 1, timeouts: null })
}

/** One pool per process, surviving Vite HMR reloads in dev. */
export const pool: pg.Pool =
	globalThis.__klipstackPool ?? createPool({ max: poolMax(), timeouts: dbTimeouts("web") })
if (process.env.NODE_ENV !== "production") globalThis.__klipstackPool = pool

/**
 * Gives the pool's connections the limits of another process (the web's are the default). Call it
 * when the process starts, before the first query: connections already open keep their limits.
 */
export function setDatabaseProcess(process: DbProcess, target: pg.Pool = pool) {
	if (target.totalCount > 0)
		throw new Error("setDatabaseProcess must be called before the first query")
	const timeouts = dbTimeouts(process)
	target.options.connectionTimeoutMillis = timeouts.connectMs
	target.options.options = withSessionOptions(databaseUrl(), sessionOptions(timeouts)).options
}

export const db = drizzle({ client: pool, schema, casing: "snake_case" })
export type Db = typeof db
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]
