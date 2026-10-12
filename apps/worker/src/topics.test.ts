import { randomUUID } from "node:crypto"
import type { ReviewChange, TopicArticleIn, TopicIn } from "@klipstack/ai"
import {
	and,
	db,
	documents,
	documentTopics,
	documentVersions,
	eq,
	inArray,
	isNotNull,
	isNull,
	pool,
	topicLibraries,
	topicSorts,
	topics,
	usageCounts,
	user,
	userFeatures,
} from "@klipstack/db"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { bringTopicsUpToDate, type TopicsDeps } from "./topics"

// Scoped to this file's rows: a shared development database keeps everyone else's.
const tag = `topics-${randomUUID().slice(0, 8)}`
let userId: string
let saved = 0

beforeEach(async () => {
	userId = `${tag}-${randomUUID().slice(0, 8)}`
	await db.insert(user).values({ id: userId, name: "Reader", email: `${userId}@example.com` })
	await db.insert(userFeatures).values({ userId, feature: "topics" })
	await db.insert(topicLibraries).values({ userId })
})
afterAll(async () => {
	const users = await db.select({ id: user.id }).from(user)
	await db.delete(user).where(
		inArray(
			user.id,
			users.map((u) => u.id).filter((id) => id.startsWith(tag)),
		),
	)
	await pool.end()
})

/** A ready article about `subject`: the fake models sort by subject words in its text. */
async function article(
	subject: string,
	options: { type?: "article" | "post"; deleted?: boolean; status?: "ready" | "queued" } = {},
) {
	saved++
	const [doc] = await db
		.insert(documents)
		.values({
			userId,
			sourceUrl: `https://example.com/${tag}/${saved}`,
			urlHash: `${tag}-${saved}`,
			title: `On ${subject} ${saved}`,
			siteName: "Example",
			status: options.status ?? "ready",
			type: options.type ?? "article",
			deletedAt: options.deleted ? new Date() : null,
			createdAt: new Date(Date.UTC(2026, 0, 1, 0, saved)),
		})
		.returning({ id: documents.id })
	const [version] = await db
		.insert(documentVersions)
		.values({
			documentId: doc!.id,
			version: 1,
			html: "<p></p>",
			text: `A piece about ${subject}.`,
			textHash: `${tag}-${saved}`,
			extractor: "test",
			extractorVersion: "1",
		})
		.returning({ id: documentVersions.id })
	await db.update(documents).set({ currentVersionId: version!.id }).where(eq(documents.id, doc!.id))
	return doc!.id
}

const many = async (count: number, subject: string) => {
	const ids: string[] = []
	for (let i = 0; i < count; i++) ids.push(await article(subject))
	return ids
}

const spec = (name: string, description = `Articles about ${name.toLowerCase()}.`) => ({
	name,
	description,
})

/**
 * Models the test scripts. Sorting says yes (0.9) when a word of the topic's description is the
 * article's subject, and no (0.05) otherwise; every call is recorded.
 */
function models(script: {
	propose?: () => { name: string; description: string }[]
	grow?: (
		topics: TopicIn[],
		pool: TopicArticleIn[],
	) => {
		widen?: { topicId: string; description: string; articleIds: string[]; reason: string }[]
		topics?: { name: string; description: string; articleIds: string[] }[]
	}
	review?: (topics: TopicIn[]) => ReviewChange[]
}) {
	const calls: string[] = []
	const spend = [
		{ model: "typesafe:jev-1.13.0", inputTokens: 1000, outputTokens: 0, cacheReadTokens: 0 },
	]
	const deps: TopicsDeps = {
		limit: 100,
		again: async () => void calls.push("again"),
		models: {
			available: true,
			async propose({ articles }) {
				calls.push(`propose:${articles.length}`)
				return {
					value: (script.propose?.() ?? []).map((t) => ({ ...t, reason: "" })),
					spend: [
						{
							model: "anthropic:claude-haiku-5-5",
							inputTokens: 10_000,
							outputTokens: 1000,
							cacheReadTokens: 0,
						},
					],
				}
			},
			async grow({ topics, pool }) {
				calls.push(`grow:${pool.length}`)
				const answer = script.grow?.(topics, pool) ?? {}
				return {
					value: {
						widen: answer.widen ?? [],
						topics: (answer.topics ?? []).map((t) => ({ ...t, reason: "" })),
						note: "",
					},
					spend: [],
				}
			},
			async review({ topics }) {
				calls.push("review")
				return { value: { changes: script.review?.(topics) ?? [], note: "" }, spend: [] }
			},
			async sort({ article, topics }) {
				calls.push("sort")
				const subject = article.text.match(/about (\w+)/)?.[1] ?? ""
				return {
					value: Object.fromEntries(
						topics.map((t) => [t.id, t.description.toLowerCase().includes(subject) ? 0.9 : 0.05]),
					),
					spend,
				}
			},
		},
	}
	return { deps, calls }
}

const run = (deps: TopicsDeps) => bringTopicsUpToDate(userId, deps)

async function confirm() {
	await db
		.update(topics)
		.set({ status: "active" })
		.where(and(eq(topics.userId, userId), eq(topics.status, "proposed")))
	await db
		.update(topicLibraries)
		.set({ confirmedAt: new Date() })
		.where(eq(topicLibraries.userId, userId))
}

async function topicNamed(name: string) {
	const [row] = await db
		.select()
		.from(topics)
		.where(and(eq(topics.userId, userId), eq(topics.name, name)))
	return row!
}

/** The topics an article is in, by name: applied, and not refused by the reader. */
async function topicsOf(documentId: string) {
	const rows = await db
		.select({ name: topics.name })
		.from(documentTopics)
		.innerJoin(topics, eq(topics.id, documentTopics.topicId))
		.where(
			and(
				eq(documentTopics.documentId, documentId),
				eq(documentTopics.level, "applied"),
				isNull(documentTopics.refusedAt),
				eq(topics.status, "active"),
			),
		)
	return rows.map((r) => r.name).sort()
}

async function usage(metric: "topics" | "ai_spend") {
	const [row] = await db
		.select({ count: usageCounts.count })
		.from(usageCounts)
		.where(and(eq(usageCounts.userId, userId), eq(usageCounts.metric, metric)))
	return row?.count ?? 0
}

describe("the first topics", () => {
	it("wait for 25 ready articles, then are proposed for the reader to confirm", async () => {
		const { deps, calls } = models({ propose: () => [spec("Cats"), spec("Dogs")] })
		await many(24, "cats")
		await article("dogs", { status: "queued" })
		await article("dogs", { deleted: true })
		await article("dogs", { type: "post" })
		expect(await run(deps)).toEqual({ done: "nothing", why: "waiting" })

		await article("dogs")
		expect(await run(deps)).toEqual({ done: "proposed", topics: 2 })
		expect(calls).toEqual(["propose:25"])
		const proposed = await db.select().from(topics).where(eq(topics.userId, userId))
		expect(proposed.map((t) => [t.name, t.status, t.origin])).toEqual([
			["Cats", "proposed", "first"],
			["Dogs", "proposed", "first"],
		])
		expect(await usage("topics")).toBe(1)
		// 10,000 tokens in and 1,000 out at Haiku's prices: $0.0015.
		expect(await usage("ai_spend")).toBe(1500)

		// Waiting for the reader: nothing more is asked.
		expect(await run(deps)).toEqual({ done: "nothing", why: "waiting" })
		expect(calls).toEqual(["propose:25"])
	})

	it("ask again only after more articles when none came back", async () => {
		const { deps, calls } = models({ propose: () => [] })
		await many(25, "cats")
		expect(await run(deps)).toEqual({ done: "proposed", topics: 0 })
		await many(4, "cats")
		expect(await run(deps)).toEqual({ done: "nothing", why: "waiting" })
		await article("cats")
		await run(deps)
		expect(calls).toEqual(["propose:25", "propose:30"])
	})

	it("are asked for again at once when the request failed, and wait for the answer as proposing", async () => {
		const { deps, calls } = models({ propose: () => [spec("Cats")] })
		await many(25, "cats")
		const failing = {
			...deps,
			models: {
				...deps.models,
				propose: async () => {
					calls.push("propose:failed")
					throw new Error("Haiku is down")
				},
			},
		}
		await expect(run(failing)).rejects.toThrow("Haiku is down")
		const [library] = await db
			.select()
			.from(topicLibraries)
			.where(eq(topicLibraries.userId, userId))
		expect(library!.proposedAtCount).toBeNull()
		expect(await run(deps)).toEqual({ done: "proposed", topics: 1 })
		expect(calls).toEqual(["propose:failed", "propose:25"])
	})

	it("are not asked for past the month's cap, nor without the feature or the providers", async () => {
		await many(25, "cats")
		const capped = models({ propose: () => [spec("Cats")] })
		expect(await run({ ...capped.deps, limit: 0 })).toEqual({ done: "nothing", why: "capped" })
		const unavailable = models({})
		unavailable.deps.models.available = false
		expect(await run(unavailable.deps)).toEqual({ done: "nothing", why: "unavailable" })
		await db.delete(userFeatures).where(eq(userFeatures.userId, userId))
		expect(await run(capped.deps)).toEqual({ done: "nothing", why: "no-feature" })
		expect(capped.calls).toEqual([])
		await db.delete(topicLibraries).where(eq(topicLibraries.userId, userId))
		expect(await run(capped.deps)).toEqual({ done: "nothing", why: "off" })
	})
})

describe("after the reader confirms", () => {
	async function confirmed(script: Parameters<typeof models>[0] = {}) {
		const setup = models({ propose: () => [spec("Cats"), spec("Dogs")], ...script })
		const cats = await many(13, "cats")
		const dogs = await many(12, "dogs")
		await run(setup.deps)
		await confirm()
		setup.calls.length = 0
		return { ...setup, cats, dogs }
	}

	it("sorts the library in batches, then each new article once", async () => {
		const { deps, calls, cats, dogs } = await confirmed()
		const owl = await article("owls")
		const trashed = await article("cats", { deleted: true })
		expect(await run({ ...deps, batch: 20 })).toMatchObject({ done: "sorted", articles: 20 })
		expect(calls.at(-1)).toBe("again")
		expect(await run({ ...deps, batch: 20 })).toMatchObject({ done: "sorted", articles: 6 })

		expect(await topicsOf(cats[0]!)).toEqual(["Cats"])
		expect(await topicsOf(dogs[0]!)).toEqual(["Dogs"])
		expect(await topicsOf(owl)).toEqual([])
		const sorted = await db.select().from(topicSorts).where(eq(topicSorts.userId, userId))
		expect(sorted).toHaveLength(26)
		expect(sorted.some((s) => s.documentId === trashed)).toBe(false)

		calls.length = 0
		const late = await article("dogs")
		await run(deps)
		expect(calls.filter((c) => c === "sort")).toHaveLength(1)
		expect(await topicsOf(late)).toEqual(["Dogs"])
	})

	it("grows a topic once enough articles fit none, sorts the library into it, and never re-creates a removed one", async () => {
		const { deps, calls } = await confirmed({
			grow: (_topics, pool) => ({
				topics: [
					{ ...spec("Owls"), articleIds: pool.map((a) => a.id) },
					{ ...spec("Ferrets"), articleIds: pool.map((a) => a.id) },
				],
			}),
		})
		await run(deps)
		await db
			.insert(topics)
			.values({ userId, ...spec("Ferrets"), status: "removed", origin: "first" })
		const owls = await many(4, "owls")
		await run(deps)
		expect(calls.filter((c) => c.startsWith("grow"))).toEqual([])
		owls.push(await article("owls"))
		const outcome = await run(deps)
		expect(outcome).toMatchObject({ done: "sorted", grew: 1 })
		expect(calls.filter((c) => c.startsWith("grow"))).toEqual(["grow:5"])
		for (const id of owls) expect(await topicsOf(id)).toEqual(["Owls"])
		const ferretTopics = await db
			.select()
			.from(topics)
			.where(and(eq(topics.userId, userId), eq(topics.name, "Ferrets")))
		expect(ferretTopics.map((t) => t.status)).toEqual(["removed"])
		const [library] = await db
			.select()
			.from(topicLibraries)
			.where(eq(topicLibraries.userId, userId))
		expect(library!.unsortedAtLastGrow).toBe(0)
	})

	it("never puts an article back in a topic the reader took it out of, even when the topic widens", async () => {
		const { deps, cats } = await confirmed({
			grow: (topics) => ({
				widen: [
					{
						topicId: topics.find((t) => t.name === "Cats")!.id,
						description: "Articles about cats, and about owls.",
						articleIds: [],
						reason: "",
					},
				],
			}),
		})
		await run(deps)
		const catsTopic = await topicNamed("Cats")
		await db
			.update(documentTopics)
			.set({ refusedAt: new Date() })
			.where(and(eq(documentTopics.documentId, cats[0]!), eq(documentTopics.topicId, catsTopic.id)))
		const owls = await many(5, "owls")
		expect(await run(deps)).toMatchObject({ widened: 1 })
		expect(await topicsOf(owls[0]!)).toEqual(["Cats"])
		expect(await topicsOf(cats[0]!)).toEqual([])
		expect(await topicsOf(cats[1]!)).toEqual(["Cats"])
	})

	it("reviews after twenty articles saved since confirming: a merge keeps refusals, a reader's name stays", async () => {
		let changes: ReviewChange[] = []
		const { deps, calls, cats, dogs } = await confirmed({ review: () => changes })
		const catsTopic = await topicNamed("Cats")
		const dogsTopic = await topicNamed("Dogs")
		await db.update(topics).set({ namedByReader: true }).where(eq(topics.id, dogsTopic.id))
		changes = [
			{
				op: "rename",
				topicIds: [dogsTopic.id],
				into: [spec("Hounds", "Articles about dogs and hounds.")],
				reason: "",
			},
		]
		// The library's first sort, right after confirming, is not reviewed: the reader just chose.
		await run(deps)
		expect(calls.filter((c) => c === "review")).toHaveLength(0)
		await many(19, "dogs")
		await run(deps)
		expect(calls.filter((c) => c === "review")).toHaveLength(0)
		await article("dogs")
		await run(deps)
		expect(calls.filter((c) => c === "review")).toHaveLength(1)
		expect(await topicNamed("Dogs")).toMatchObject({
			description: "Articles about dogs and hounds.",
		})

		await db
			.update(documentTopics)
			.set({ refusedAt: new Date() })
			.where(and(eq(documentTopics.documentId, cats[0]!), eq(documentTopics.topicId, catsTopic.id)))
		changes = [
			{
				op: "merge",
				topicIds: [catsTopic.id, dogsTopic.id],
				into: [spec("Pets", "Articles about cats and dogs.")],
				reason: "",
			},
		]
		await many(20, "cats")
		await run(deps)
		expect(calls.filter((c) => c === "review")).toHaveLength(2)
		const ended = await db
			.select()
			.from(topics)
			.where(inArray(topics.id, [catsTopic.id, dogsTopic.id]))
		expect(ended.map((t) => t.status)).toEqual(["retired", "retired"])
		expect(await topicsOf(dogs[0]!)).toEqual(["Pets"])
		expect(await topicsOf(cats[1]!)).toEqual(["Pets"])
		expect(await topicsOf(cats[0]!)).toEqual([])
		const refusals = await db
			.select()
			.from(documentTopics)
			.where(and(eq(documentTopics.documentId, cats[0]!), isNotNull(documentTopics.refusedAt)))
		expect(refusals).toHaveLength(1)
	})

	it("splits a topic into parts, copying its refusals to each", async () => {
		let changes: ReviewChange[] = []
		const { deps, cats, dogs } = await confirmed({ review: () => changes })
		await run(deps)
		const catsTopic = await topicNamed("Cats")
		await db
			.update(documentTopics)
			.set({ refusedAt: new Date() })
			.where(and(eq(documentTopics.documentId, cats[0]!), eq(documentTopics.topicId, catsTopic.id)))
		changes = [
			{
				op: "split",
				topicIds: [catsTopic.id],
				into: [
					spec("House cats", "Articles about cats at home."),
					spec("Big cats", "Articles about wild cats."),
				],
				reason: "",
			},
		]
		await many(20, "dogs")
		await run(deps)
		expect(await topicsOf(cats[1]!)).toEqual(["Big cats", "House cats"])
		expect(await topicsOf(cats[0]!)).toEqual([])
		expect(await topicsOf(dogs[0]!)).toEqual(["Dogs"])
	})
})
