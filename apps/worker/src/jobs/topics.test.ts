import { randomUUID } from "node:crypto"
import { AiError, DecisionError } from "@klipstack/ai"
import {
	db,
	documents,
	documentVersions,
	eq,
	pool,
	sql,
	topicLibraries,
	user,
	userFeatures,
} from "@klipstack/db"
import { stopBoss } from "@klipstack/queue"
import type { JobWithMetadata } from "pg-boss"
import { afterAll, describe, expect, it } from "vitest"
import type { TopicsDeps } from "../topics"
import { handleTopics, queueTopicsAfterSave } from "./topics"

const tag = `topics-job-${randomUUID().slice(0, 8)}`

afterAll(async () => {
	await db.delete(user).where(sql`${user.id} like ${`${tag}%`}`)
	await stopBoss()
	await pool.end()
})

async function reader(withTopics: boolean) {
	const id = `${tag}-${randomUUID().slice(0, 8)}`
	await db.insert(user).values({ id, name: "Reader", email: `${id}@example.com` })
	await db.insert(userFeatures).values({ userId: id, feature: "topics" })
	if (withTopics) await db.insert(topicLibraries).values({ userId: id })
	return id
}

/** Ready articles, enough for a first proposal. */
async function articles(userId: string, count: number) {
	for (let i = 0; i < count; i++) {
		const [doc] = await db
			.insert(documents)
			.values({
				userId,
				sourceUrl: `https://example.com/${tag}/${randomUUID()}`,
				urlHash: randomUUID(),
				status: "ready",
				title: `Article ${i}`,
			})
			.returning({ id: documents.id })
		const [version] = await db
			.insert(documentVersions)
			.values({
				documentId: doc!.id,
				version: 1,
				html: "<p>Text</p>",
				text: "Text",
				textHash: randomUUID(),
				extractor: "test",
				extractorVersion: "1",
			})
			.returning({ id: documentVersions.id })
		await db
			.update(documents)
			.set({ currentVersionId: version!.id })
			.where(eq(documents.id, doc!.id))
	}
}

const job = (userId: string) =>
	({ data: { userId }, retryCount: 0, retryLimit: 3 }) as JobWithMetadata<{ userId: string }>

/** Models that fail every request with `error`. */
function failing(error: Error): TopicsDeps {
	const fail = async () => {
		throw error
	}
	return {
		limit: 100,
		again: async () => {},
		models: { available: true, propose: fail, grow: fail, review: fail, sort: fail },
	}
}

async function queued(userId: string) {
	const rows = await db.execute<{ count: number }>(
		sql`select count(*)::int as count from pgboss.job where name = 'topics' and data->>'userId' = ${userId}`,
	)
	return rows.rows[0]!.count
}

describe("the topics job", () => {
	it("is queued after a save only for a reader with topics on", async () => {
		const on = await reader(true)
		const off = await reader(false)
		await queueTopicsAfterSave(on)
		await queueTopicsAfterSave(off)
		expect(await queued(on)).toBe(1)
		expect(await queued(off)).toBe(0)
	})

	it("ends quietly on a request a provider refused, and fails on one worth retrying", async () => {
		const refused = new AiError("provider", "refused", {
			cause: new DecisionError("Jev answered HTTP 422", false),
		})
		const down = new AiError("provider", "down", { cause: new Error("socket hang up") })
		const quiet = await reader(true)
		await articles(quiet, 25)
		await expect(handleTopics(job(quiet), failing(refused))).resolves.toBeUndefined()
		const loud = await reader(true)
		await articles(loud, 25)
		await expect(handleTopics(job(loud), failing(down))).rejects.toThrow("down")
	})
})
