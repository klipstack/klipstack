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

export function databaseUrl(): string {
	const url = process.env.DATABASE_URL
	if (!url) throw new Error("DATABASE_URL is not set")
	return url
}
