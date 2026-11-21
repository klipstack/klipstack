import type { QueueName } from "@klipstack/queue"
import type { WorkOptions } from "pg-boss"
import { EXTRACT_CONCURRENCY } from "./parse"

/**
 * Jobs of one queue that run at once in this process. Every queue shares one event loop; the
 * CPU-heavy part of extraction runs on parse threads (./parse.ts), so a slow site or a slow page
 * holds one slot, not the queue.
 *
 * - extract: a job mostly waits on the network (a fetch takes up to 15 s); one more than the
 *   parse threads, so a fetch can run while two pages parse.
 * - images: sharp decodes on its own threads, two at a time across jobs (images.ts), which bounds
 *   their memory however many jobs run.
 * - every other queue: one at a time, as before.
 */
export const CONCURRENCY: Partial<Record<QueueName, number>> = {
	extract: EXTRACT_CONCURRENCY + 1,
	images: 2,
}

/** metadata gives handlers retryCount/retryLimit. */
export function workOptions(queue: QueueName): WorkOptions & { includeMetadata: true } {
	return {
		batchSize: 1,
		includeMetadata: true,
		localConcurrency: CONCURRENCY[queue] ?? 1,
		// pg-boss waits a polling interval (2 s by default) after every job, even with more waiting:
		// a reader who saved ten links would wait 20 s for the last. Half a second is its minimum.
		...(queue === "extract" ? { pollingIntervalSeconds: 0.5 } : {}),
	}
}
