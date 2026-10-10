import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"
import { databaseUrl, loadEnv, poolMax } from "./env"
import * as schema from "./schema"

loadEnv()

declare global {
	var __klipstackPool: pg.Pool | undefined
}

/** One pool per process, surviving Vite HMR reloads in dev. */
export const pool: pg.Pool =
	globalThis.__klipstackPool ??
	new pg.Pool({
		connectionString: databaseUrl(),
		max: poolMax(),
	})
if (process.env.NODE_ENV !== "production") globalThis.__klipstackPool = pool

export const db = drizzle({ client: pool, schema, casing: "snake_case" })
export type Db = typeof db
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]
