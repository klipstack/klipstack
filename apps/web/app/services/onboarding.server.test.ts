import { randomUUID } from "node:crypto"
import {
	db,
	documents,
	documentVersions,
	highlights,
	sql,
	user as userTable,
	userFeatures,
} from "@klipstack/db"
import { stopBoss } from "@klipstack/queue"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { findStarterText, starterUrlHash } from "~/lib/starter-texts.server"

vi.hoisted(() => {
	process.env.AI_FAKE = "1"
})

const { setPrefs } = await import("~/commands/account.server")
const { endGettingStarted } = await import("~/commands/onboarding.server")
const { disableTopics, enableTopics } = await import("~/commands/topics.server")
const { gettingStarted } = await import("./onboarding.server")
const { topicModels } = await import("~/lib/ai.server")

const tag = `test-getting-started-${randomUUID().slice(0, 8)}`
let userId: string
let otherId: string

beforeEach(async () => {
	userId = `${tag}-${randomUUID().slice(0, 8)}`
	otherId = `${userId}-other`
	await db.insert(userTable).values([
		{ id: userId, name: "Reader", email: `${userId}@example.com` },
		{ id: otherId, name: "Other", email: `${otherId}@example.com` },
	])
})
afterAll(async () => {
	await db.delete(userTable).where(sql`${userTable.id} like ${`${tag}%`}`)
	await stopBoss()
})

const steps = (id = userId, extension = true) => gettingStarted(id, { extension })
const none = { save: false, extension: false, highlight: false, feature: false, topics: false }

async function save(owner: string, fields: Partial<typeof documents.$inferInsert> = {}) {
	const [doc] = await db
		.insert(documents)
		.values({
			userId: owner,
			sourceUrl: `https://example.com/${randomUUID()}`,
			urlHash: randomUUID(),
			status: "ready",
			...fields,
		})
		.returning({ id: documents.id })
	return doc!.id
}

async function highlight(owner: string, documentId: string) {
	const [version] = await db
		.insert(documentVersions)
		.values({
			documentId,
			version: 1,
			html: "<p>Words</p>",
			text: "Words",
			textHash: randomUUID(),
			extractor: "test",
			extractorVersion: "1",
		})
		.returning({ id: documentVersions.id })
	await db.insert(highlights).values({
		userId: owner,
		documentId,
		versionId: version!.id,
		startOffset: 0,
		endOffset: 5,
		exact: "Words",
	})
}

describe("Getting started", () => {
	it("starts with every step to do", async () => {
		expect(await steps()).toEqual(none)
	})

	it("ticks saving from an article the reader saved, not a starter text, and nobody else's", async () => {
		const guide = findStarterText("guide-en")!
		await save(userId, { sourceUrl: guide.url, urlHash: starterUrlHash(guide) })
		expect((await steps())!.save).toBe(false)
		await save(otherId)
		expect((await steps())!.save).toBe(false)
		await save(userId)
		expect(await steps()).toEqual({ ...none, save: true })
	})

	it("ticks the extension from an article saved with it; offers it only where asked, unless done", async () => {
		expect((await steps(userId, false))!.extension).toBeNull()
		await save(userId, { captureSource: "web" })
		expect((await steps())!.extension).toBe(false)
		await save(userId, { captureSource: "extension" })
		expect((await steps())!.extension).toBe(true)
		expect((await steps(userId, false))!.extension).toBe(true)
	})

	it("ticks highlighting from a highlight in any article, the guide's too", async () => {
		const guide = findStarterText("guide-en")!
		const doc = await save(userId, { sourceUrl: guide.url, urlHash: starterUrlHash(guide) })
		await highlight(userId, doc)
		expect(await steps()).toEqual({ ...none, highlight: true })
	})

	it("ticks the features from one turned on, for good, even if turned off again", async () => {
		await setPrefs(userId, { editions: "on" })
		await setPrefs(userId, { editions: "off" })
		expect((await steps())!.feature).toBe(true)
		// Turned on before the onboarding record existed.
		await db
			.update(userTable)
			.set({ prefs: { feeds: "on" } })
			.where(sql`${userTable.id} = ${otherId}`)
		expect((await steps(otherId))!.feature).toBe(true)
	})

	it("ticks the features from topics turned on, and names topics only where they can be", async () => {
		await db.insert(userFeatures).values({ userId, feature: "topics" })
		expect((await steps())!.topics).toBe(true)
		const available = vi.spyOn(topicModels, "available", "get").mockReturnValue(false)
		try {
			expect((await steps())!.topics).toBe(false)
		} finally {
			available.mockRestore()
		}
		await enableTopics(userId)
		await disableTopics(userId)
		expect((await steps())!.feature).toBe(true)
	})

	it("keeps the first time a feature was turned on when topics are turned on later", async () => {
		vi.useFakeTimers({ toFake: ["Date"] })
		try {
			vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
			await setPrefs(userId, { feeds: "on" })
			vi.setSystemTime(new Date("2026-02-01T00:00:00Z"))
			await db.insert(userFeatures).values({ userId, feature: "topics" })
			await enableTopics(userId)
		} finally {
			vi.useRealTimers()
		}
		const [row] = await db
			.select({ prefs: userTable.prefs })
			.from(userTable)
			.where(sql`${userTable.id} = ${userId}`)
		expect(row!.prefs.onboarding?.featureOnAt).toBe("2026-01-01T00:00:00.000Z")
	})

	it("is over once ended, for this account only", async () => {
		await endGettingStarted(userId)
		expect(await steps()).toBeNull()
		expect(await steps(otherId)).toEqual(none)
	})
})
