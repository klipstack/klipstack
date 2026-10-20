import { randomUUID } from "node:crypto"
import { AiError, DecisionError } from "@klipstack/ai"
import {
	accountBilling,
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
import { handleTopics, handleTopicsMonth, queueTopicsAfterSave } from "./topics"

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
		sortLimit: 1000,
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

	it("is queued on the 1st for every reader with topics on and the feature, as the sorts start again", async () => {
		const on = await reader(true)
		const off = await reader(false)
		const unflagged = await reader(true)
		await db.delete(userFeatures).where(eq(userFeatures.userId, unflagged))
		// Its trial ended: billing started 60 days ago, the account 45.
		const lapsed = await reader(true)
		const DAY = 24 * 60 * 60 * 1000
		await db
			.update(user)
			.set({ createdAt: new Date(Date.now() - 45 * DAY) })
			.where(eq(user.id, lapsed))
		process.env.BILLING_STARTS_AT = new Date(Date.now() - 60 * DAY).toISOString()
		try {
			await handleTopicsMonth()
		} finally {
			delete process.env.BILLING_STARTS_AT
		}
		expect(await queued(on)).toBe(1)
		expect(await queued(off)).toBe(0)
		expect(await queued(unflagged)).toBe(0)
		expect(await queued(lapsed)).toBe(0)
		// A run for now: nothing waits for a later time and holds the reader's place in the queue.
		const [row] = (
			await db.execute<{ late: boolean }>(
				sql`select start_after > now() + interval '1 minute' as late from pgboss.job where name = 'topics' and data->>'userId' = ${on}`,
			)
		).rows
		expect(row).toEqual({ late: false })
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

	it("runs nothing for a lapsed account, whatever queued the run", async () => {
		const down = new AiError("provider", "down", { cause: new Error("socket hang up") })
		const lapsed = await reader(true)
		await articles(lapsed, 25)
		// An admin's date in the past, with billing on: lapsed.
		await db
			.insert(accountBilling)
			.values({ userId: lapsed, freeUntil: new Date(Date.now() - 86_400_000) })
		process.env.BILLING_STARTS_AT = new Date(Date.now() - 90 * 86_400_000).toISOString()
		try {
			// A run would reach the provider, and fail.
			await expect(handleTopics(job(lapsed), failing(down))).resolves.toBeUndefined()
		} finally {
			delete process.env.BILLING_STARTS_AT
		}
	})
})
