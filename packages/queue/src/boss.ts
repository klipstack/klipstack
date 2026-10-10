import { databaseUrl, loadEnv } from "@klipstack/db"
import { logError } from "@klipstack/log"
import { PgBoss, type SendOptions } from "pg-boss"
import { type JobPayloads, QUEUE_OPTIONS, QUEUES, type QueueName } from "./jobs"

loadEnv()

declare global {
	var __klipstackBoss: Promise<PgBoss> | undefined
}

/**
 * Lazily start a pg-boss instance bound to the app database. One per process.
 * Producers and consumers share this; `ensureQueues` is idempotent.
 */
export function getBoss(): Promise<PgBoss> {
	if (!globalThis.__klipstackBoss) {
		globalThis.__klipstackBoss = (async () => {
			const boss = new PgBoss({ connectionString: databaseUrl(), schema: "pgboss" })
			boss.on("error", (error: Error) => logError("[pg-boss]", error))
			await boss.start()
			await ensureQueues(boss)
			return boss
		})()
	}
	return globalThis.__klipstackBoss
}

/**
 * Creates the queues, and gives existing ones the options in QUEUE_OPTIONS: `createQueue` leaves
 * an existing queue as it is, so a changed option would otherwise never reach production.
 */
export async function ensureQueues(boss: PgBoss) {
	for (const name of Object.values(QUEUES)) {
		await boss.createQueue(name, QUEUE_OPTIONS[name])
		await boss.updateQueue(name, QUEUE_OPTIONS[name])
	}
}

export async function enqueue<Q extends QueueName>(
	queue: Q,
	payload: JobPayloads[Q],
	options?: SendOptions,
): Promise<string | null> {
	const boss = await getBoss()
	return boss.send(queue, payload, options ?? {})
}

export async function stopBoss() {
	if (!globalThis.__klipstackBoss) return
	const boss = await globalThis.__klipstackBoss
	await boss.stop({ graceful: true })
	globalThis.__klipstackBoss = undefined
}
