import { loadEnv, pool, setDatabaseProcess } from "@klipstack/db"
import { welcomeFrom } from "@klipstack/email"
import { getBoss, type JobPayloads, QUEUES, stopBoss } from "@klipstack/queue"
import { getStorage } from "@klipstack/storage"
import type { JobWithMetadata } from "pg-boss"
import { startHeartbeat } from "./heartbeat"
import { handleExport } from "./jobs/export"
import { handleExtract } from "./jobs/extract"
import { handleFeedFetch, handleFeedsTick } from "./jobs/feeds"
import { handleImages } from "./jobs/images"
import { handleInviteDigest } from "./jobs/invite-digest"
import { handlePurge } from "./jobs/purge"
import { handleReportDigest } from "./jobs/report-digest"
import { handleSweep } from "./jobs/sweep"
import { handleTopics, handleTopicsMonth } from "./jobs/topics"
import { handleWelcomeEmail } from "./jobs/welcome-email"
import { log } from "./log"

loadEnv()
// Jobs (purge, feeds, topics) may run statements longer than a web request's. Before any query.
setDatabaseProcess("worker")

/** One job at a time per queue; metadata gives handlers retryCount/retryLimit. */
const WORK_OPTIONS = { batchSize: 1, includeMetadata: true } as const

type Batch<Q extends keyof JobPayloads> = JobWithMetadata<JobPayloads[Q]>[]

async function main() {
	// A wrong setting stops the worker now, not at the first image job or welcome email. The
	// database URL and the pool size are checked when `@klipstack/db` loads.
	getStorage()
	const welcome = welcomeFrom(process.env)
	const boss = await getBoss()
	log.info("worker started")

	// pg-boss waits a polling interval (2 s by default) after every job, even with more waiting:
	// a reader who saved ten links would wait 20 s for the last. Half a second is its minimum.
	const extractOptions = { ...WORK_OPTIONS, pollingIntervalSeconds: 0.5 }
	await boss.work(QUEUES.extract, extractOptions, async ([job]: Batch<"extract">) => {
		if (job) await handleExtract(job)
	})
	await boss.work(QUEUES.images, WORK_OPTIONS, async ([job]: Batch<"images">) => {
		// The outcome (completed, or skipped and why) becomes the job's output.
		if (job) return handleImages(job)
	})
	await boss.work(QUEUES.export, WORK_OPTIONS, async ([job]: Batch<"export">) => {
		if (job) await handleExport(job)
	})
	await boss.work(QUEUES.purge, WORK_OPTIONS, async () => {
		await handlePurge()
	})
	await boss.work(QUEUES.feedsTick, WORK_OPTIONS, async () => {
		await handleFeedsTick()
	})
	await boss.work(QUEUES.feedFetch, WORK_OPTIONS, async ([job]: Batch<"feed-fetch">) => {
		if (job) await handleFeedFetch(job)
	})
	await boss.work(QUEUES.sweep, WORK_OPTIONS, async () => {
		await handleSweep()
	})
	await boss.work(QUEUES.inviteDigest, WORK_OPTIONS, async () => {
		const digest = await handleInviteDigest()
		if (digest.fresh > 0) log.info("invite digest", digest)
	})
	await boss.work(QUEUES.reportDigest, WORK_OPTIONS, async () => {
		const digest = await handleReportDigest()
		if (digest.fresh > 0) log.info("report digest", digest)
	})
	await boss.work(QUEUES.topics, WORK_OPTIONS, async ([job]: Batch<"topics">) => {
		if (job) await handleTopics(job)
	})
	await boss.work(QUEUES.topicsMonth, WORK_OPTIONS, async () => {
		log.info("topics: the month's runs", await handleTopicsMonth())
	})
	await boss.work(QUEUES.welcomeEmail, WORK_OPTIONS, async () => {
		const welcomed = await handleWelcomeEmail({ from: welcome })
		if (welcomed.sent + welcomed.failed > 0) log.info("welcome emails", welcomed)
	})
	// Trash retention: once a day, 04:10 UTC. `schedule` upserts, so restarts are harmless.
	await boss.schedule(QUEUES.purge, "10 4 * * *", {}, { tz: "UTC" })
	// Feeds: every 5 minutes, queue the ones that are due (each feed keeps its own schedule).
	await boss.schedule(QUEUES.feedsTick, "*/5 * * * *", {}, { tz: "UTC" })
	// Extractions whose job is gone: every 10 minutes.
	await boss.schedule(QUEUES.sweep, "*/10 * * * *", {}, { tz: "UTC" })
	// New wait list requests, to the admins: once a day, 08:00 UTC.
	await boss.schedule(QUEUES.inviteDigest, "0 8 * * *", {}, { tz: "UTC" })
	// New reports on public editions, to the admins: every hour, at a quarter past.
	await boss.schedule(QUEUES.reportDigest, "15 * * * *", {}, { tz: "UTC" })
	// Welcome emails, to new accounts whose address is verified: every minute.
	await boss.schedule(QUEUES.welcomeEmail, "* * * * *", {}, { tz: "UTC" })
	// Topics' month: on the 1st, 00:05 UTC, runs for readers whose sorts waited for it.
	await boss.schedule(QUEUES.topicsMonth, "5 0 1 * *", {}, { tz: "UTC" })

	// Every consumer is registered: from here on the process counts as alive.
	const stopHeartbeat = startHeartbeat()

	const shutdown = async (signal: string) => {
		log.info(`received ${signal}, shutting down`)
		stopHeartbeat()
		await stopBoss()
		await pool.end()
		process.exit(0)
	}
	process.on("SIGINT", () => void shutdown("SIGINT"))
	process.on("SIGTERM", () => void shutdown("SIGTERM"))
}

main().catch((error) => {
	// Nothing the users sent is handled before the worker starts, so the message (a connection or
	// configuration problem) is safe, and needed to fix it.
	log.error("worker failed to start", {
		error,
		message: error instanceof Error ? error.message : String(error),
	})
	process.exit(1)
})
