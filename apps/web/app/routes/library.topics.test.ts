import {
	db,
	documents,
	documentTopics,
	eq,
	newId,
	topicLibraries,
	topicSorts,
	topics,
	user,
	userFeatures,
} from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { loader } from "./library"

const session = vi.hoisted(() => ({ user: { id: "", name: "Reader", locale: "en" } }))
vi.mock("~/lib/session.server", () => ({ requireUser: () => session.user }))
// Topics need their models: the fake ones, which answer without calling anyone.
vi.hoisted(() => {
	process.env.AI_FAKE = "1"
})

const readerId = `test-library-topics-route-${newId()}`
const withoutId = `${readerId}-without`
const topicIds: Record<string, string> = {}

async function library(owner: string) {
	await db
		.insert(topicLibraries)
		.values({ userId: owner, proposedAt: new Date(), confirmedAt: new Date() })
	const add = async (title: string, values: Partial<typeof documents.$inferInsert> = {}) => {
		const [doc] = await db
			.insert(documents)
			.values({
				userId: owner,
				sourceUrl: `https://example.com/${title}`,
				urlHash: newId(),
				status: "ready",
				title,
				...values,
			})
			.returning({ id: documents.id })
		await db.insert(topicSorts).values({ documentId: doc!.id, userId: owner })
		return doc!.id
	}
	for (const [name, count] of [
		["Science", 2],
		["Economics", 1],
	] as const) {
		const [topic] = await db
			.insert(topics)
			.values({
				userId: owner,
				name,
				description: `About ${name}.`,
				status: "active",
				origin: "first",
			})
			.returning({ id: topics.id })
		topicIds[`${owner}:${name}`] = topic!.id
		for (let i = 0; i < count; i++)
			await db.insert(documentTopics).values({
				documentId: await add(`${name} ${i}`),
				topicId: topic!.id,
				probability: 0.9,
				level: "applied",
			})
	}
	const [ended] = await db
		.insert(topics)
		.values({ userId: owner, name: "Ended", description: "", status: "retired", origin: "first" })
		.returning({ id: topics.id })
	topicIds[`${owner}:Ended`] = ended!.id
	await add("Unsorted")
	await add("Archived", { archivedAt: new Date() })
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

async function list(id: string, path: string) {
	session.user.id = id
	return loader({
		request: new Request(`http://localhost${path}`),
		context: {},
		params: {},
	} as never)
}
const titles = (data: Awaited<ReturnType<typeof list>>) => data.items.map((d) => d.title).sort()

describe("the library's topic choice", () => {
	it("offers the reader's topics with what each holds of the list, and labels the cards", async () => {
		const data = await list(readerId, "/library")
		expect(data.topics?.topics.map((t) => [t.name, t.count])).toEqual([
			["Science", 2],
			["Economics", 1],
		])
		expect(data.topics).toMatchObject({ none: 1, sorting: 0 })
		expect(data.topic).toBeNull()
		const label = (title: string) => data.labels[data.items.find((d) => d.title === title)!.id]
		expect(label("Science 1")).toBe("Science")
		expect(label("Unsorted")).toBeUndefined()
	})

	it("narrows the list, and its filter counts, to the topic chosen", async () => {
		const id = topicIds[`${readerId}:Science`]!
		const data = await list(readerId, `/library?topic=${id}&show=unread`)
		expect(data.topic).toBe(id)
		expect(titles(data)).toEqual(["Science 0", "Science 1"])
		expect(data.counts).toMatchObject({ unread: 2 })
		expect(data.labels).toEqual({})
		expect(titles(await list(readerId, "/library?topic=none"))).toEqual(["Unsorted"])
		expect(titles(await list(readerId, "/archive?topic=none"))).toEqual(["Archived"])
	})

	it("shows every topic for one that ended, another reader's, or no topic at all", async () => {
		for (const asked of [
			topicIds[`${readerId}:Ended`],
			topicIds[`${withoutId}:Science`],
			"nonsense",
		]) {
			const data = await list(readerId, `/library?topic=${asked}`)
			expect(data.topic).toBeNull()
			expect(data.topicGone).toBe(true)
			expect(titles(data)).toContain("Unsorted")
		}
	})

	it("has no topic choice without the topics feature, nor in the trash", async () => {
		const data = await list(withoutId, `/library?topic=${topicIds[`${withoutId}:Science`]}`)
		expect(data).toMatchObject({ topics: null, topic: null, topicGone: false, labels: {} })
		expect(titles(data)).toContain("Unsorted")
		expect((await list(readerId, "/trash?topic=none")).topics).toBeNull()
	})
})
