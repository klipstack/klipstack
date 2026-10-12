import {
	db,
	documents,
	documentTopics,
	eq,
	newId,
	topicLibraries,
	topics,
	user,
	userFeatures,
} from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { loader } from "./reading-home"

const session = vi.hoisted(() => ({ user: { id: "", name: "Reader", locale: "en" } }))
vi.mock("~/lib/session.server", () => ({ requireUser: () => session.user }))
// Topics need their models: the fake ones, which answer without calling anyone.
vi.hoisted(() => {
	process.env.AI_FAKE = "1"
})
vi.mock("~/lib/i18n.server", async () => {
	const { createInstance } = await import("i18next")
	const { resources } = await import("@klipstack/i18n")
	const i18n = createInstance()
	await i18n.init({ resources, fallbackLng: "en", interpolation: { escapeValue: false } })
	return { getInstance: () => i18n }
})

const readerId = `test-home-topics-route-${newId()}`
const withoutId = `${readerId}-without`
const topicIds: Record<string, string> = {}

async function library(owner: string) {
	await db
		.insert(topicLibraries)
		.values({ userId: owner, proposedAt: new Date(), confirmedAt: new Date() })
	for (const [name, count, lastRead] of [
		["Science", 3, new Date("2026-10-01")],
		["Economics", 2, null],
	] as const) {
		const [topic] = await db
			.insert(topics)
			.values({ userId: owner, name, description: name, status: "active", origin: "first" })
			.returning({ id: topics.id })
		topicIds[`${owner}:${name}`] = topic!.id
		for (let i = 0; i < count; i++) {
			const [doc] = await db
				.insert(documents)
				.values({
					userId: owner,
					sourceUrl: `https://example.com/${name}/${i}`,
					urlHash: newId(),
					status: "ready",
					title: `${name} ${i}`,
					readingMinutes: 10,
					lastReadAt: i === 0 ? lastRead : null,
				})
				.returning({ id: documents.id })
			await db
				.insert(documentTopics)
				.values({ documentId: doc!.id, topicId: topic!.id, probability: 0.9, level: "applied" })
		}
	}
	await db.insert(documents).values({
		userId: owner,
		sourceUrl: "https://example.com/unsorted",
		urlHash: newId(),
		status: "ready",
		title: "Unsorted",
		readingMinutes: 10,
	})
}

beforeAll(async () => {
	await db
		.insert(user)
		.values([readerId, withoutId].map((id) => ({ id, name: "Reader", email: `${id}@example.com` })))
	await db.insert(userFeatures).values({ userId: readerId, feature: "topics" })
	await library(readerId)
	await library(withoutId)
})
afterAll(async () => {
	for (const id of [readerId, withoutId]) await db.delete(user).where(eq(user.id, id))
})

async function home(id: string, search = "") {
	session.user.id = id
	return loader({
		request: new Request(`http://localhost/home${search}`),
		context: {},
		params: {},
	} as never)
}
const titles = (data: Awaited<ReturnType<typeof home>>) =>
	[...data.candidates.reading, ...data.candidates.recent, ...data.candidates.rediscover]
		.map((d) => d.title)
		.sort()

describe("Home's topic choice", () => {
	it("offers the reader's topics, most to read first, and labels the articles", async () => {
		const data = await home(readerId)
		expect(data.topics?.list.map((t) => [t.name, t.toRead])).toEqual([
			["Science", 3],
			["Economics", 2],
		])
		expect(data.topics?.different).toBe(topicIds[`${readerId}:Economics`])
		expect(data.topics?.chosen).toBeNull()
		const all = [
			...data.candidates.reading,
			...data.candidates.recent,
			...data.candidates.rediscover,
		]
		for (const doc of all)
			expect(data.labels[doc.id]).toBe(
				doc.title?.startsWith("Unsorted") ? undefined : doc.title?.split(" ")[0],
			)
		expect(titles(data)).toContain("Unsorted")
	})

	it("narrows Home to the topic chosen", async () => {
		const id = topicIds[`${readerId}:Science`]!
		const data = await home(readerId, `?topic=${id}`)
		expect(data.topics?.chosen).toMatchObject({ id, name: "Science", toRead: 3, different: false })
		expect(titles(data)).toEqual(["Science 0", "Science 1", "Science 2"])
		expect(data.feed).toEqual([])
	})

	it("keeps something different the same topic once chosen, after the reader reads from it", async () => {
		const economics = topicIds[`${readerId}:Economics`]!
		const chosen = await home(readerId, `?topic=${economics}&different`)
		expect(chosen.topics?.chosen).toMatchObject({ name: "Economics", different: true })
		expect(titles(chosen)).toEqual(["Economics 0", "Economics 1"])
		// Reading from it makes Science the one read from least lately: offered next time.
		const opened = chosen.candidates.recent.find((d) => d.title === "Economics 1")!
		await db.update(documents).set({ lastReadAt: new Date() }).where(eq(documents.id, opened.id))
		const after = await home(readerId, `?topic=${economics}&different`)
		expect(after.topics?.chosen).toMatchObject({ name: "Economics", different: true })
		expect(after.topics?.different).toBe(topicIds[`${readerId}:Science`])
	})

	it("ignores a topic that is not the reader's, or not a topic", async () => {
		for (const search of [`?topic=${topicIds[`${withoutId}:Science`]}`, "?topic=nonsense"]) {
			const data = await home(readerId, search)
			expect(data.topics?.chosen).toBeNull()
			expect(titles(data)).toContain("Unsorted")
		}
	})

	it("has no topic choice without the topics feature", async () => {
		const data = await home(withoutId, `?topic=${topicIds[`${withoutId}:Science`]}`)
		expect(data.topics).toBeNull()
		expect(data.labels).toEqual({})
		expect(titles(data)).toContain("Unsorted")
	})
})
