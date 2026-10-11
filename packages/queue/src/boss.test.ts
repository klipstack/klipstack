import { pool } from "@klipstack/db"
import { afterAll, describe, expect, it } from "vitest"
import { ensureQueues, getBoss, QUEUE_OPTIONS, QUEUES, stopBoss } from "./index"

afterAll(async () => {
	await stopBoss()
	await pool.end()
})

describe("ensureQueues", () => {
	it("gives an existing queue the options it has in the code", async () => {
		const boss = await getBoss()
		await boss.updateQueue(QUEUES.extract, { expireInSeconds: 999, retryLimit: 9 })
		await ensureQueues(boss)
		expect(await boss.getQueue(QUEUES.extract)).toMatchObject({
			expireInSeconds: QUEUE_OPTIONS.extract.expireInSeconds,
			retryLimit: QUEUE_OPTIONS.extract.retryLimit,
		})
	})

	it("creates the topics queue stately, and keeps it so when started again", async () => {
		const boss = await getBoss()
		await ensureQueues(boss)
		expect(await boss.getQueue(QUEUES.topics)).toMatchObject({ policy: "stately" })
	})
})
