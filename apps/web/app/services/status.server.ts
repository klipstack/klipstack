import { db, sql } from "@klipstack/db"
import { errorLabel } from "@klipstack/log"
import { getBoss, QUEUES } from "@klipstack/queue"
import { withinTime } from "~/lib/time-limit.server"
import { readWorkerStatus } from "./admin-system.server"

/**
 * What the uptime monitor reads at /status: is background work being done? The database alone is
 * /healthcheck's question. Anyone can ask, so the answer is one word; the reasons go to the log.
 */
export type PublicStatus = "ok" | "degraded"

/** A due job has waited this long while its queue started nothing: no worker is taking its jobs. */
export const QUEUE_STALL_SECONDS = 600
/** Anyone can ask: the queries run at most this often, and every caller in between shares them. */
const CACHE_MS = 15_000

export interface QueueFacts {
	queue: string
	/** Seconds the oldest due job has waited since it became due, or null with none waiting. */
	waitingSeconds: number | null
	active: number
	/** Seconds since the queue last started a job pg-boss still retains, or null with none. */
	sinceStartSeconds: number | null
}

/**
 * A backlog that is being worked through is not a stall, however old its oldest job: a stall is a
 * due job waiting with nothing running and nothing started in all that time. A long job (an export,
 * the purge) keeps its queue active until pg-boss expires it.
 */
export function queueStalled(facts: QueueFacts): boolean {
	if (facts.waitingSeconds === null || facts.waitingSeconds <= QUEUE_STALL_SECONDS) return false
	if (facts.active > 0) return false
	return facts.sinceStartSeconds === null || facts.sinceStartSeconds > QUEUE_STALL_SECONDS
}

/** Reads named columns of pg-boss's job table and never writes to it. */
export async function readQueueFacts(): Promise<QueueFacts[]> {
	await getBoss()
	const result = await db.execute<{
		name: string
		waiting: number | null
		active: number
		since_start: number | null
	}>(sql`
		select name,
			extract(epoch from now() - min(greatest(created_on, start_after))
				filter (where state in ('created', 'retry') and start_after <= now()))::int as waiting,
			count(*) filter (where state = 'active')::int as active,
			extract(epoch from now() - max(started_on))::int as since_start
		from pgboss.job
		group by name
	`)
	const names = new Set<string>(Object.values(QUEUES))
	return result.rows
		.filter((row) => names.has(row.name))
		.map((row) => ({
			queue: row.name,
			waitingSeconds: row.waiting,
			active: row.active,
			sinceStartSeconds: row.since_start,
		}))
}

/**
 * The reasons the service is degraded, as log-safe words: none means ok. A check that cannot be
 * read is a reason too, and so is a worker that never reported: an alert must not pass on silence.
 */
export async function degradedReasons(): Promise<string[]> {
	const [worker, queues] = await Promise.allSettled([
		withinTime(readWorkerStatus),
		withinTime(readQueueFacts),
	])
	const reasons: string[] = []
	if (worker.status === "rejected") reasons.push(`worker unreadable (${errorLabel(worker.reason)})`)
	else if (worker.value.state !== "recent") reasons.push(`worker ${worker.value.state}`)
	if (queues.status === "rejected") reasons.push(`queues unreadable (${errorLabel(queues.reason)})`)
	else
		for (const facts of queues.value)
			if (queueStalled(facts)) reasons.push(`queue ${facts.queue} stalled`)
	return reasons
}

let cached: { at: number; status: Promise<PublicStatus> } | undefined

async function check(): Promise<PublicStatus> {
	const reasons = await degradedReasons()
	if (reasons.length === 0) return "ok"
	console.warn(`[status] degraded: ${reasons.join(", ")}`)
	return "degraded"
}

export function publicStatus(now = Date.now()): Promise<PublicStatus> {
	if (!cached || now - cached.at >= CACHE_MS) cached = { at: now, status: check() }
	return cached.status
}

/** For tests. */
export function resetStatusCache() {
	cached = undefined
}
