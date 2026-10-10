/**
 * Queue names and payload types shared by producers (web) and consumers (worker).
 */
/** A capture that never succeeded holds only its URL: it leaves the trash sooner. */
export const FAILED_RETENTION_DAYS = 7

export const QUEUES = {
	extract: "extract",
	images: "images",
	export: "export",
	purge: "purge",
	feedsTick: "feeds-tick",
	feedFetch: "feed-fetch",
	sweep: "sweep",
	inviteDigest: "invite-digest",
	reportDigest: "report-digest",
} as const

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]

export interface JobPayloads {
	extract: { documentId: string }
	images: { versionId: string }
	export: { userId: string; requestId: string }
	/** Scheduled daily: empties trash older than the retention period and drops orphaned images. */
	purge: Record<string, never>
	/** Scheduled every few minutes: queues a fetch for each followed feed that is due. */
	"feeds-tick": Record<string, never>
	"feed-fetch": { feedId: string }
	/** Scheduled every few minutes: settles extractions whose job is gone. */
	sweep: Record<string, never>
	/** Scheduled daily: emails the admins when new wait list requests arrived. */
	"invite-digest": Record<string, never>
	/** Scheduled hourly: emails the admins when new reports on public editions arrived. */
	"report-digest": Record<string, never>
}

export const QUEUE_OPTIONS: Record<
	QueueName,
	{ retryLimit: number; retryDelay: number; retryBackoff: boolean; expireInSeconds: number }
> = {
	// Expiry is when pg-boss gives up on a running job and starts its retry beside it: well past the
	// worst case (extract: a 15 s fetch, X thread lookups, then parsing; images: 60 images four at a
	// time, 15 s each, plus the lead image), so one job doesn't publish twice.
	extract: { retryLimit: 3, retryDelay: 15, retryBackoff: true, expireInSeconds: 300 },
	images: { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 600 },
	export: { retryLimit: 1, retryDelay: 60, retryBackoff: false, expireInSeconds: 600 },
	purge: { retryLimit: 1, retryDelay: 300, retryBackoff: false, expireInSeconds: 1800 },
	"feeds-tick": { retryLimit: 0, retryDelay: 60, retryBackoff: false, expireInSeconds: 120 },
	// No retries: a failed fetch reschedules itself through the feed's backoff.
	"feed-fetch": { retryLimit: 0, retryDelay: 60, retryBackoff: false, expireInSeconds: 120 },
	sweep: { retryLimit: 0, retryDelay: 60, retryBackoff: false, expireInSeconds: 120 },
	// A retry resends the whole digest: an admin may get it twice, never not at all.
	"invite-digest": { retryLimit: 2, retryDelay: 600, retryBackoff: false, expireInSeconds: 300 },
	"report-digest": { retryLimit: 2, retryDelay: 600, retryBackoff: false, expireInSeconds: 300 },
}
