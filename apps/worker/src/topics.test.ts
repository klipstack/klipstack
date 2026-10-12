import { randomUUID } from "node:crypto"
import {
	AiError,
	DecisionError,
	type ReviewChange,
	type TopicArticleIn,
	type TopicIn,
} from "@klipstack/ai"
import {
	and,
	db,
	documents,
	documentTopics,
	documentVersions,
	eq,
	inArray,
	isNull,
	pool,
	sql,
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

const spec = (
	name: string,
	description = `Articles about ${name.toLowerCase()}.`,
	boundary = "",
) => ({ name, description, boundary })

/**
 * Models the test scripts. Sorting says yes (0.9) when a word of the topic's description is the
 * article's subject, and no (0.05) otherwise; every call is recorded. `sort` may refuse an article
 * or do something meanwhile (`during`), as a reader would while a request is on its way.
 */
function models(script: {
	propose?: () => { name: string; description: string; boundary: string }[]
	grow?: (
		topics: TopicIn[],
		pool: TopicArticleIn[],
	) => {
		widen?: {
			topicId: string
			description: string
			boundary: string
			articleIds: string[]
			reason: string
		}[]
		topics?: { name: string; description: string; boundary: string; articleIds: string[] }[]
	}
	review?: (topics: TopicIn[]) => ReviewChange[]
	/** Sees the topics each article is sorted against. */
	sorting?: (topics: TopicIn[]) => void
	refuse?: (article: TopicArticleIn) => boolean
	during?: (call: string) => Promise<void>
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
				await script.during?.("propose")
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
				await script.during?.("grow")
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
				script.sorting?.(topics)
				await script.during?.("sort")
				if (script.refuse?.(article))
					throw new AiError("provider", "Jev refused", {
						cause: new DecisionError("Jev answered HTTP 422", false),
					})
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

/** Runs until nothing is left for a next run, as the queue would. */
async function settle(deps: TopicsDeps, calls: string[]) {
	for (let i = 0; i < 50; i++) {
		const before = calls.filter((c) => c === "again").length
		await run(deps)
		if (calls.filter((c) => c === "again").length === before) return
	}
	throw new Error("the runs never settled")
}

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

async function refuse(documentId: string, topicId: string) {
	await db
		.update(documentTopics)
		.set({ refusedAt: new Date() })
		.where(and(eq(documentTopics.documentId, documentId), eq(documentTopics.topicId, topicId)))
}

async function usage(metric: "topics" | "ai_spend") {
	const [row] = await db
		.select({ count: usageCounts.count })
		.from(usageCounts)
		.where(and(eq(usageCounts.userId, userId), eq(usageCounts.metric, metric)))
	return row?.count ?? 0
}

const statuses = async () =>
	(await db.select().from(topics).where(eq(topics.userId, userId)))
		.map((t) => [t.name, t.status])
		.sort((a, b) => a[0]!.localeCompare(b[0]!))

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
		expect(proposed.map((t) => [t.name, t.status, t.origin]).sort()).toEqual([
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

	it("are asked for again at once when the request failed, which spends none of the cap", async () => {
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
		expect(await usage("topics")).toBe(0)
		expect(await run(deps)).toEqual({ done: "proposed", topics: 1 })
		expect(calls).toEqual(["propose:failed", "propose:25"])
	})

	it("keep only names a reader could give, and cut long descriptions", async () => {
		const { deps } = models({
			propose: () => [
				spec("  Cats  "),
				spec("cats"),
				spec("x".repeat(61)),
				spec("Dogs\u0000"),
				spec("Owls", "y".repeat(5000)),
			],
		})
		await many(25, "cats")
		expect(await run(deps)).toEqual({ done: "proposed", topics: 2 })
		const rows = await db.select().from(topics).where(eq(topics.userId, userId))
		expect(rows.map((t) => [t.name, t.description.length]).sort()).toEqual([
			["Cats", "Articles about   cats  .".replace(/\s+/g, " ").length],
			["Owls", 600],
		])
	})

	it("keep what readers see apart from the boundary, and sort by both", async () => {
		const sorted: TopicIn[][] = []
		const { deps, calls } = models({
			propose: () => [
				spec("Cats", "Articles about cats.", "  Owls belong in   Birds. "),
				spec("Dogs", "Articles about dogs.", "z".repeat(5000)),
				spec("Mice", "Articles about mice.", "   "),
			],
			sorting: (topics) => void sorted.push(topics),
		})
		await many(25, "cats")
		await run(deps)
		const rows = await db.select().from(topics).where(eq(topics.userId, userId))
		expect(
			rows.map((t) => [t.name, t.description, t.boundary.slice(0, 20), t.boundary.length]).sort(),
		).toEqual([
			["Cats", "Articles about cats.", "Owls belong in Birds", 21],
			["Dogs", "Articles about dogs.", "z".repeat(20), 600],
			["Mice", "Articles about mice.", "", 0],
		])
		await confirm()
		await settle(deps, calls)
		expect(sorted.at(-1)!.find((t) => t.name === "Cats")).toMatchObject({
			description: "Articles about cats.",
			boundary: "Owls belong in Birds.",
		})
	})

	it("keep nothing when the reader turns topics off while they are being proposed", async () => {
		const { deps } = models({
			propose: () => [spec("Cats")],
			during: async () => {
				await db.delete(topicLibraries).where(eq(topicLibraries.userId, userId))
			},
		})
		await many(25, "cats")
		expect(await run(deps)).toEqual({ done: "nothing", why: "off" })
		expect(await db.select().from(topics).where(eq(topics.userId, userId))).toEqual([])
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

	it("leaves out an article a provider refuses, and goes on with the others", async () => {
		let refused = ""
		const { deps, calls, cats } = await confirmed({ refuse: (a) => a.id === refused })
		refused = cats[0]!
		await settle(deps, calls)
		expect(await topicsOf(cats[0]!)).toEqual([])
		expect(await topicsOf(cats[1]!)).toEqual(["Cats"])
		const sorted = await db.select().from(topicSorts).where(eq(topicSorts.userId, userId))
		expect(sorted).toHaveLength(25)
	})

	it("grows a topic once enough articles fit none, sorts the library into it in batches, and never re-creates a removed one", async () => {
		const { deps, calls } = await confirmed({
			grow: (_topics, pool) => ({
				topics: [
					{ ...spec("Owls"), articleIds: pool.map((a) => a.id) },
					{ ...spec("Ferrets"), articleIds: pool.map((a) => a.id) },
				],
			}),
		})
		await settle(deps, calls)
		await db
			.insert(topics)
			.values({ userId, ...spec("Ferrets"), status: "removed", origin: "first" })
		const owls = await many(4, "owls")
		await settle(deps, calls)
		expect(calls.filter((c) => c.startsWith("grow"))).toEqual([])
		owls.push(await article("owls"))
		// Small batches: the library is sorted into the new topic over several runs.
		await settle({ ...deps, batch: 7 }, calls)
		expect(calls.filter((c) => c.startsWith("grow"))).toEqual(["grow:5"])
		expect(calls.filter((c) => c === "again").length).toBeGreaterThan(2)
		for (const id of owls) expect(await topicsOf(id)).toEqual(["Owls"])
		expect(
			(await statuses()).filter(([name]) => name === "Ferrets").map(([, status]) => status),
		).toEqual(["removed"])
		expect((await topicNamed("Owls")).resortPending).toBe(false)
		const [library] = await db
			.select()
			.from(topicLibraries)
			.where(eq(topicLibraries.userId, userId))
		expect(library).toMatchObject({ unsortedAtLastGrow: 5, resortAfterAt: null })
	})

	it("keeps nothing a growth brings when the reader turns topics off meanwhile", async () => {
		let off = false
		const { deps, calls } = await confirmed({
			grow: (_topics, pool) => ({
				topics: [{ ...spec("Owls"), articleIds: pool.map((a) => a.id) }],
			}),
			during: async (call) => {
				if (call === "grow" && off)
					await db.delete(topicLibraries).where(eq(topicLibraries.userId, userId))
			},
		})
		await settle(deps, calls)
		await many(5, "owls")
		off = true
		await settle(deps, calls)
		expect((await statuses()).map(([name]) => name)).not.toContain("Owls")
	})

	it("gives nothing to a topic the reader removed while the article was being sorted", async () => {
		let remove: string | null = null
		const { deps, calls, cats } = await confirmed({
			during: async (call) => {
				if (call === "sort" && remove)
					await db.update(topics).set({ status: "removed" }).where(eq(topics.id, remove))
			},
		})
		await settle(deps, calls)
		remove = (await topicNamed("Cats")).id
		const late = await article("cats")
		await settle(deps, calls)
		expect(await topicsOf(late)).toEqual([])
		const rows = await db
			.select()
			.from(documentTopics)
			.where(and(eq(documentTopics.documentId, late), eq(documentTopics.topicId, remove)))
		expect(rows).toEqual([])
		void cats
	})

	it("never puts an article back in a topic the reader took it out of, even when the topic widens", async () => {
		const { deps, calls, cats } = await confirmed({
			grow: (topics) => ({
				widen: [
					{
						topicId: topics.find((t) => t.name === "Cats")!.id,
						description: "Articles about cats, and about owls.",
						boundary: "Articles about birds belong in Birds.",
						articleIds: [],
						reason: "",
					},
				],
			}),
		})
		await settle(deps, calls)
		const catsTopic = await topicNamed("Cats")
		await refuse(cats[0]!, catsTopic.id)
		const owls = await many(5, "owls")
		await settle(deps, calls)
		expect(calls.filter((c) => c.startsWith("grow"))).toHaveLength(1)
		expect(await topicsOf(owls[0]!)).toEqual(["Cats"])
		expect(await topicsOf(cats[0]!)).toEqual([])
		expect(await topicsOf(cats[1]!)).toEqual(["Cats"])
		expect(await topicNamed("Cats")).toMatchObject({
			description: "Articles about cats, and about owls.",
			boundary: "Articles about birds belong in Birds.",
		})
	})
})

describe("reviews", () => {
	async function reviewing(changes: (topics: TopicIn[]) => ReviewChange[]) {
		const setup = models({ propose: () => [spec("Cats"), spec("Dogs")], review: changes })
		const cats = await many(13, "cats")
		const dogs = await many(12, "dogs")
		await run(setup.deps)
		await confirm()
		await settle(setup.deps, setup.calls)
		return { ...setup, cats, dogs }
	}

	it("wait for twenty articles saved since confirming", async () => {
		const { deps, calls } = await reviewing(() => [])
		expect(calls.filter((c) => c === "review")).toHaveLength(0)
		await many(19, "dogs")
		await settle(deps, calls)
		expect(calls.filter((c) => c === "review")).toHaveLength(0)
		await article("dogs")
		await settle(deps, calls)
		expect(calls.filter((c) => c === "review")).toHaveLength(1)
	})

	it("merge two topics into one, all at once, carrying the reader's refusals", async () => {
		let changes: ReviewChange[] = []
		const { deps, calls, cats, dogs } = await reviewing(() => changes)
		const [catsTopic, dogsTopic] = [await topicNamed("Cats"), await topicNamed("Dogs")]
		await refuse(cats[0]!, catsTopic.id)
		changes = [
			{
				op: "merge",
				topicIds: [catsTopic.id, dogsTopic.id],
				into: [spec("Pets", "Articles about cats and dogs.")],
				reason: "",
			},
		]
		await many(20, "cats")
		await settle(deps, calls)
		expect(await statuses()).toEqual([
			["Cats", "retired"],
			["Dogs", "retired"],
			["Pets", "active"],
		])
		expect(await topicsOf(dogs[0]!)).toEqual(["Pets"])
		expect(await topicsOf(cats[1]!)).toEqual(["Pets"])
		expect(await topicsOf(cats[0]!)).toEqual([])
	})

	it("clean what a merge brings as a proposal's: one line, cut to size", async () => {
		let changes: ReviewChange[] = []
		const { deps, calls } = await reviewing(() => changes)
		const [catsTopic, dogsTopic] = [await topicNamed("Cats"), await topicNamed("Dogs")]
		changes = [
			{
				op: "merge",
				topicIds: [catsTopic.id, dogsTopic.id],
				into: [
					spec(
						"Pets",
						"Articles about\u0000 cats and   dogs.",
						` Owls belong in   Birds. ${"z".repeat(5000)}`,
					),
				],
				reason: "",
			},
		]
		await many(20, "cats")
		await settle(deps, calls)
		const pets = await topicNamed("Pets")
		expect(pets.description).toBe("Articles about cats and dogs.")
		expect(pets.boundary.startsWith("Owls belong in Birds. zzz")).toBe(true)
		expect(pets.boundary).toHaveLength(600)
	})

	it("split a topic into parts, copying its refusals to each", async () => {
		let changes: ReviewChange[] = []
		const { deps, calls, cats, dogs } = await reviewing(() => changes)
		const catsTopic = await topicNamed("Cats")
		await refuse(cats[0]!, catsTopic.id)
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
		await settle(deps, calls)
		expect(await topicsOf(cats[1]!)).toEqual(["Big cats", "House cats"])
		expect(await topicsOf(cats[0]!)).toEqual([])
		expect(await topicsOf(dogs[0]!)).toEqual(["Dogs"])
	})

	it("only sharpen the description of a topic the reader named, and never take a removed name", async () => {
		let changes: ReviewChange[] = []
		const { deps, calls } = await reviewing(() => changes)
		const [catsTopic, dogsTopic] = [await topicNamed("Cats"), await topicNamed("Dogs")]
		await db.update(topics).set({ namedByReader: true }).where(eq(topics.id, dogsTopic.id))
		await db
			.insert(topics)
			.values({ userId, ...spec("Felines"), status: "removed", origin: "first" })
		changes = [
			{
				op: "rename",
				topicIds: [dogsTopic.id],
				into: [spec("Hounds", "Articles about dogs and hounds.", "Wolves belong in Wildlife.")],
				reason: "",
			},
			{ op: "rename", topicIds: [catsTopic.id], into: [spec("Felines")], reason: "" },
			{ op: "retire", topicIds: [dogsTopic.id], into: [], reason: "" },
			{
				op: "merge",
				topicIds: [catsTopic.id, dogsTopic.id],
				into: [spec("Pets", "Articles about cats and dogs.")],
				reason: "",
			},
		]
		await many(20, "dogs")
		await settle(deps, calls)
		expect(await topicNamed("Dogs")).toMatchObject({
			status: "active",
			description: "Articles about dogs and hounds.",
			boundary: "Wolves belong in Wildlife.",
		})
		expect(await topicNamed("Cats")).toMatchObject({
			status: "active",
			description: "Articles about felines.",
		})
		expect((await statuses()).map(([name]) => name)).not.toContain("Pets")
	})

	it("retire every topic they name", async () => {
		let changes: ReviewChange[] = []
		const { deps, calls, cats } = await reviewing(() => changes)
		const [catsTopic, dogsTopic] = [await topicNamed("Cats"), await topicNamed("Dogs")]
		changes = [{ op: "retire", topicIds: [catsTopic.id, dogsTopic.id], into: [], reason: "" }]
		await many(20, "dogs")
		await settle(deps, calls)
		expect(await statuses()).toEqual([
			["Cats", "retired"],
			["Dogs", "retired"],
		])
		expect(await topicsOf(cats[0]!)).toEqual([])
	})
})

describe("re-sorting the library", () => {
	it("goes through articles saved at the same moment, one batch after another", async () => {
		const setup = models({
			propose: () => [spec("Cats")],
			grow: (_topics, pool) => ({
				topics: [{ ...spec("Owls"), articleIds: pool.map((a) => a.id) }],
			}),
		})
		await many(25, "cats")
		await run(setup.deps)
		await confirm()
		await settle(setup.deps, setup.calls)
		// Five owls saved in the same millisecond, microseconds apart: the cursor must not skip any.
		const owls = await many(5, "owls")
		for (const [i, id] of owls.entries())
			await db
				.update(documents)
				.set({
					createdAt: sql`'2026-06-01T00:00:00.000001Z'::timestamptz + ${i} * interval '1 microsecond'`,
				})
				.where(eq(documents.id, id))
		await settle({ ...setup.deps, batch: 2 }, setup.calls)
		for (const id of owls) expect(await topicsOf(id)).toEqual(["Owls"])
	})

	it("skips a model's topic whose name the reader gave a topic meanwhile", async () => {
		const setup = models({
			propose: () => [spec("Cats")],
			grow: (_topics, pool) => ({
				topics: [{ ...spec("Owls"), articleIds: pool.map((a) => a.id) }],
			}),
			during: async (call) => {
				if (call !== "grow") return
				const [cats] = await db.select().from(topics).where(eq(topics.userId, userId))
				await db
					.update(topics)
					.set({ name: "owls", namedByReader: true })
					.where(eq(topics.id, cats!.id))
			},
		})
		await many(25, "cats")
		await run(setup.deps)
		await confirm()
		await settle(setup.deps, setup.calls)
		await many(5, "owls")
		await settle(setup.deps, setup.calls)
		expect(await statuses()).toEqual([["owls", "active"]])
	})
})
