import { randomUUID } from "node:crypto"
import { and, db, eq, monthOf, usageCounts, user as userTable, userFeatures } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { action } from "./topics.use"

// The route over the real command and database; only the session stands in.
const reader = `test-topics-use-route-${randomUUID()}`
vi.mock("~/lib/session.server", () => ({ requireUser: () => ({ id: reader }) }))

beforeAll(async () => {
	await db.insert(userTable).values({ id: reader, name: "Reader", email: `${reader}@example.com` })
	await db.insert(userFeatures).values({ userId: reader, feature: "topics" })
})
afterAll(async () => {
	await db.delete(userTable).where(eq(userTable.id, reader))
})

const post = (body: FormData) =>
	action({
		request: new Request("https://example.com/topics/use", { method: "POST", body }),
		params: {},
		context: {},
	} as Parameters<typeof action>[0])

const form = (use: string) => {
	const body = new FormData()
	body.set("use", use)
	return body
}

describe("POST /topics/use", () => {
	it("counts a click, as the reader's browser sends it, and refuses anything else", async () => {
		expect(await post(form("topic_next"))).toEqual({ ok: true })
		expect(await post(form("topic_removed"))).toMatchObject({ init: { status: 400 } })
		const [row] = await db
			.select({ metric: usageCounts.metric, count: usageCounts.count })
			.from(usageCounts)
			.where(and(eq(usageCounts.userId, reader), eq(usageCounts.month, monthOf().month)))
		expect(row).toEqual({ metric: "topic_next", count: 1 })
	})
})
