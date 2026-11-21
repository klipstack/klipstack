import { randomUUID } from "node:crypto"
import { pool } from "@klipstack/db"
import { getBoss, QUEUES, stopBoss } from "@klipstack/queue"
import { afterAll, describe, expect, it } from "vitest"
import { CONCURRENCY, workOptions } from "./work-options"

// A queue of its own, worked with the extract queue's options: the real extract queue may hold
// jobs from other tests.
const queue = `test-concurrency-${randomUUID()}`

afterAll(async () => {
	const boss = await getBoss()
	await boss.offWork(queue)
	await boss.deleteQueue(queue)
	await stopBoss()
	await pool.end()
})

describe("workOptions", () => {
	it("runs extraction a few jobs at a time, never more, and a stuck job holds only its slot", async () => {
		const limit = CONCURRENCY.extract!
		expect(limit).toBeGreaterThan(1)
		const boss = await getBoss()
		await boss.createQueue(queue)

		let running = 0
		let most = 0
		const done: string[] = []
		let releaseStuck!: () => void
		const stuck = new Promise<void>((resolve) => (releaseStuck = resolve))
		await boss.work<{ n: number }>(queue, workOptions(QUEUES.extract), async ([job]) => {
			if (!job) return
			running++
			most = Math.max(most, running)
			try {
				if (job.data.n === 0) await stuck
				else await new Promise((resolve) => setTimeout(resolve, 150))
				done.push(String(job.data.n))
			} finally {
				running--
			}
		})
		await boss.send(queue, { n: 0 })
		for (let n = 1; n <= 8; n++) await boss.send(queue, { n })

		// The other eight finish while the first is stuck.
		await expect.poll(() => done.length, { timeout: 15_000, interval: 100 }).toBe(8)
		expect(done).not.toContain("0")
		expect(most).toBe(limit)
		releaseStuck()
		await expect.poll(() => done.length, { timeout: 5_000 }).toBe(9)
	}, 30_000)

	it("keeps every other queue at one job at a time", () => {
		expect(workOptions(QUEUES.purge).localConcurrency).toBe(1)
		expect(workOptions(QUEUES.feedFetch).localConcurrency).toBe(1)
		expect(workOptions(QUEUES.extract).pollingIntervalSeconds).toBe(0.5)
	})
})
