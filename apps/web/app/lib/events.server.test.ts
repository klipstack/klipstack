import { randomUUID } from "node:crypto"
import { type DocumentEvent, db, notifyDocumentEvent, sql } from "@klipstack/db"
import { afterAll, describe, expect, it } from "vitest"
import { stopDocumentEvents, subscribeDocumentEvents } from "./events.server"

afterAll(() => stopDocumentEvents())

const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

/** What a stream hears: events, and null for "you may have missed some". */
function stream(userId: string, since: number) {
	const heard: (DocumentEvent | null)[] = []
	const stop = subscribeDocumentEvents(userId, since, (event) => heard.push(event))
	streams.push(stop)
	return heard
}
const streams: (() => void)[] = []
afterAll(() => streams.forEach((stop) => stop()))

describe("subscribeDocumentEvents", () => {
	it("tells a stream whether its user's events came after its page was read", async () => {
		const reader = `test-events-${randomUUID()}`
		const other = `test-events-${randomUUID()}`
		// The process starts listening after this page was read: what came before is unknown.
		const first = stream(reader, Date.now() - 1000)
		await expect.poll(() => first, { timeout: 5000 }).toEqual([null])

		await tick()
		const readBefore = Date.now()
		await tick()
		const event: DocumentEvent = { userId: reader, documentId: randomUUID(), kind: "ready" }
		await notifyDocumentEvent(event)
		await expect.poll(() => first, { timeout: 5000 }).toEqual([null, event])
		await tick()
		const readAfter = Date.now()

		// A page read before the event, whose stream opens after it: it missed it.
		expect(stream(reader, readBefore)).toEqual([null])
		// A page read after it, or another reader's: nothing missed.
		expect(stream(reader, readAfter)).toEqual([])
		expect(stream(other, readBefore)).toEqual([])
		// A time ahead of this server's clock (another server read the page): it may have missed.
		expect(stream(other, Date.now() + 60_000)).toEqual([null])
	})

	it("after the listening connection drops, every stream refreshes, and so do pages read before", async () => {
		const reader = `test-events-${randomUUID()}`
		const open = stream(reader, Date.now())
		await expect.poll(() => open, { timeout: 5000 }).toEqual([])
		await tick()
		const readDuringOutage = Date.now()
		// The web app's LISTEN connection is the only one in this database: no other test file listens.
		await db.execute(sql`
			select pg_terminate_backend(pid) from pg_stat_activity
			where datname = current_database() and query = 'listen klipstack_documents'`)
		// Back after its reconnect delay: the open stream was told it may have missed something.
		await expect.poll(() => open, { timeout: 10_000 }).toEqual([null])
		// A page read during the outage, with no event of its reader's heard since: it refreshes too.
		expect(stream(`test-events-${randomUUID()}`, readDuringOutage)).toEqual([null])
	})
})
