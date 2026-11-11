import {
	type Db,
	db,
	type KeyProvider,
	type KeyResult,
	keyChecks,
	keyProviders,
	sql,
	type Tx,
} from "@klipstack/db"
import { errorLabel } from "@klipstack/log"
import { type AdminContext, assertAdminContext } from "~/lib/admin.server"
import { appVersion, env } from "~/lib/env.server"
import { withinTime } from "~/lib/time-limit.server"
import { type QueueSummary, queueSummary } from "./admin-jobs.server"

/** A worker seen within this many seconds is alive; after that its report is stale. */
export const WORKER_RECENT_SECONDS = 90

/** `unknown`: no worker has reported yet. It is not a failure, and an idle worker still reports. */
export type WorkerState = "recent" | "stale" | "unknown"

export function workerState(secondsSinceSeen: number | null): WorkerState {
	if (secondsSinceSeen === null || !Number.isFinite(secondsSinceSeen)) return "unknown"
	return secondsSinceSeen <= WORKER_RECENT_SECONDS ? "recent" : "stale"
}

/** A value, or the fact that it could not be read. Never a zero or a green badge in its place. */
export type Observed<T> = { ok: true; value: T } | { ok: false }

async function observe<T>(label: string, read: () => Promise<T>): Promise<Observed<T>> {
	try {
		return { ok: true, value: await withinTime(read) }
	} catch (error) {
		console.warn(`[admin] ${label} unavailable: ${errorLabel(error)}`)
		return { ok: false }
	}
}

export interface WorkerStatus {
	state: WorkerState
	instanceId: string | null
	startedAt: string | null
	lastSeenAt: string | null
	secondsSinceSeen: number | null
}

/** The most recently seen worker, measured with the database's clock on both sides. */
export async function readWorkerStatus(): Promise<WorkerStatus> {
	const result = await db.execute<{
		instance_id: string
		started_at: Date
		last_seen_at: Date
		age: number
	}>(sql`
		select instance_id, started_at, last_seen_at,
			extract(epoch from now() - last_seen_at)::float as age
		from worker_heartbeats order by last_seen_at desc limit 1
	`)
	const row = result.rows[0]
	if (!row)
		return {
			state: "unknown",
			instanceId: null,
			startedAt: null,
			lastSeenAt: null,
			secondsSinceSeen: null,
		}
	return {
		state: workerState(row.age),
		instanceId: row.instance_id,
		startedAt: new Date(row.started_at).toISOString(),
		lastSeenAt: new Date(row.last_seen_at).toISOString(),
		secondsSinceSeen: Math.max(0, Math.round(row.age)),
	}
}

/**
 * Dashboards only: no API token, heartbeat ping URL or storage credential ever reaches a page.
 * OPS_UPTIME_URL and OPS_BACKUPS_URL name the team's pages (the environment check refuses anything
 * but a plain https dashboard URL). Unset, both links open Better Stack itself: no made-up team.
 */
const BETTER_STACK = "https://uptime.betterstack.com/"
export const OPERATIONS_LINKS = {
	uptime: env.OPS_UPTIME_URL ?? BETTER_STACK,
	backups: env.OPS_BACKUPS_URL ?? BETTER_STACK,
	cloudflare: "https://dash.cloudflare.com/",
}

/** One provider's key as the worker last found it; `result` null: never checked. */
export interface KeyStatus {
	provider: KeyProvider
	result: KeyResult | null
	checkedAt: string | null
}

/** Every provider, in a fixed order, whether or not the worker has checked it yet. */
export async function readKeyStatus(tx: Db | Tx = db): Promise<KeyStatus[]> {
	const rows = await tx
		.select({
			provider: keyChecks.provider,
			result: keyChecks.result,
			checkedAt: keyChecks.checkedAt,
		})
		.from(keyChecks)
	return keyProviders.map((provider) => {
		const row = rows.find((candidate) => candidate.provider === provider)
		return {
			provider,
			result: row?.result ?? null,
			checkedAt: row ? new Date(row.checkedAt).toISOString() : null,
		}
	})
}

export interface SystemStatus {
	observedAt: string
	database: Observed<{ checkedAt: string }>
	worker: Observed<WorkerStatus>
	queues: Observed<QueueSummary[]>
	keys: Observed<KeyStatus[]>
	deployment: { version: string; storage: "fs" | "s3" }
	links: typeof OPERATIONS_LINKS
}

export async function systemStatus(ctx: AdminContext): Promise<SystemStatus> {
	assertAdminContext(ctx)
	const [database, worker, queues, keys] = await Promise.all([
		observe("database", async () => {
			const result = await db.execute<{ now: Date }>(sql`select now() as now`)
			return { checkedAt: new Date(result.rows[0]?.now ?? Date.now()).toISOString() }
		}),
		observe("worker heartbeat", readWorkerStatus),
		observe("queues", () => queueSummary(ctx)),
		observe("key checks", () => readKeyStatus()),
	])
	return {
		observedAt: new Date().toISOString(),
		database,
		worker,
		queues,
		keys,
		// The configured mode. It does not show that the bucket is reachable.
		deployment: { version: appVersion, storage: env.STORAGE_DRIVER },
		links: OPERATIONS_LINKS,
	}
}

export interface Overview {
	observedAt: string
	counts: Observed<{
		accounts: number
		verifiedAccounts: number
		articles: number
		failedExtractions: number
	}>
	queues: Observed<QueueSummary[]>
}

export async function overview(ctx: AdminContext): Promise<Overview> {
	assertAdminContext(ctx)
	const [counts, queues] = await Promise.all([
		observe("counts", async () => {
			const result = await db.execute<{
				accounts: number
				verified: number
				articles: number
				failed: number
			}>(sql`
				select
					(select count(*)::int from "user") as accounts,
					(select count(*)::int from "user" where email_verified) as verified,
					(select count(*)::int from documents where deleted_at is null) as articles,
					(select count(*)::int from documents where deleted_at is null and status = 'failed') as failed
			`)
			const row = result.rows[0]
			if (!row) throw new Error("no counts")
			return {
				accounts: row.accounts,
				verifiedAccounts: row.verified,
				articles: row.articles,
				failedExtractions: row.failed,
			}
		}),
		observe("queues", () => queueSummary(ctx)),
	])
	return { observedAt: new Date().toISOString(), counts, queues }
}
