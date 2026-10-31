import { afterAll, describe, expect, it } from "vitest"
import { pool } from "./client"
import { type DocumentEvent, listenDocumentEvents, notifyDocumentEvent } from "./events"

afterAll(() => pool.end())

describe("listenDocumentEvents", () => {
	it("still hears events after idling, with every query limit at 1 ms", async () => {
		const env = { ...process.env }
		Object.assign(process.env, {
			PG_STATEMENT_TIMEOUT_MS: "1",
			PG_LOCK_TIMEOUT_MS: "1",
			PG_IDLE_IN_TRANSACTION_TIMEOUT_MS: "1",
		})
		const heard: DocumentEvent[] = []
		const stop = listenDocumentEvents((event) => heard.push(event))
		try {
			// The listening connection sits idle well past every limit: the point is that time passes.
			await new Promise((resolve) => setTimeout(resolve, 1500))
			const event: DocumentEvent = { userId: "test-events-idle", kind: "feed" }
			await notifyDocumentEvent(event)
			await expect.poll(() => heard, { timeout: 3000 }).toContainEqual(event)
		} finally {
			stop()
			process.env = env
		}
	})
})
