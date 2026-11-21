import { loadEnv, pool, setDatabaseProcess } from "@klipstack/db"
import { welcomeFrom } from "@klipstack/email"
import { getBoss, type JobPayloads, QUEUES, stopBoss } from "@klipstack/queue"
import { getStorage } from "@klipstack/storage"
import type { JobWithMetadata } from "pg-boss"
import { markAlive } from "./health"
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
import { handleTranslate } from "./jobs/translate"
import { handleWelcomeEmail } from "./jobs/welcome-email"
import { log } from "./log"
import { closeParsePool } from "./parse"
import { workOptions } from "./work-options"

loadEnv()
// Jobs (purge, feeds, topics) may run statements longer than a web request's. Before any query.
setDatabaseProcess("worker")

type Batch<Q extends keyof JobPayloads> = JobWithMetadata<JobPayloads[Q]>[]

async function main() {
	// A wrong setting stops the worker now, not at the first image job or welcome email. The
	// database URL and the pool size are checked when `@klipstack/db` loads.
	getStorage()
	const welcome = welcomeFrom(process.env)
	const boss = await getBoss()
	log.info("worker started")

	await boss.work(QUEUES.extract, workOptions(QUEUES.extract), async ([job]: Batch<"extract">) => {
		if (job) await handleExtract(job)
	})
	await boss.work(QUEUES.images, workOptions(QUEUES.images), async ([job]: Batch<"images">) => {
		// The outcome (completed, or skipped and why) becomes the job's output.
		if (job) return handleImages(job)
	})
	await boss.work(QUEUES.export, workOptions(QUEUES.export), async ([job]: Batch<"export">) => {
		if (job) await handleExport(job)
	})
	await boss.work(QUEUES.purge, workOptions(QUEUES.purge), async () => {
		await handlePurge()
	})
	await boss.work(QUEUES.feedsTick, workOptions(QUEUES.feedsTick), async () => {
		await handleFeedsTick()
	})
	await boss.work(
		QUEUES.feedFetch,
		workOptions(QUEUES.feedFetch),
		async ([job]: Batch<"feed-fetch">) => {
			if (job) await handleFeedFetch(job)
		},
	)
	await boss.work(QUEUES.sweep, workOptions(QUEUES.sweep), async () => {
		await handleSweep()
	})
	await boss.work(QUEUES.inviteDigest, workOptions(QUEUES.inviteDigest), async () => {
		const digest = await handleInviteDigest()
		if (digest.fresh > 0) log.info("invite digest", digest)
	})
	await boss.work(QUEUES.reportDigest, workOptions(QUEUES.reportDigest), async () => {
		const digest = await handleReportDigest()
		if (digest.fresh > 0) log.info("report digest", digest)
	})
	await boss.work(QUEUES.topics, workOptions(QUEUES.topics), async ([job]: Batch<"topics">) => {
		if (job) await handleTopics(job)
	})
	await boss.work(
		QUEUES.translate,
		workOptions(QUEUES.translate),
		async ([job]: Batch<"translate">) => {
			if (job) await handleTranslate(job)
		},
	)
	await boss.work(QUEUES.topicsMonth, workOptions(QUEUES.topicsMonth), async () => {
		log.info("topics: the month's runs", await handleTopicsMonth())
	})
	await boss.work(QUEUES.welcomeEmail, workOptions(QUEUES.welcomeEmail), async () => {
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

	// Every consumer is registered: from here on the process counts as alive. Each report that
	// reaches the database also renews the file the container's health check reads (health.ts).
	const stopHeartbeat = startHeartbeat({ onBeat: markAlive })

	const shutdown = async (signal: string) => {
		log.info(`received ${signal}, shutting down`)
		stopHeartbeat()
		await stopBoss()
		await closeParsePool()
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
