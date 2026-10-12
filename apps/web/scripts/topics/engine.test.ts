import { describe, expect, it } from "vitest"
import { type Article, type Config, DEFAULT_CONFIG, Simulation } from "./engine"
import type { Models } from "./models"

const ANIMALS = ["cats", "dogs", "owls"]

/** An article about one animal or several; its id starts with its number, as the proposer sees it. */
function article(n: number, ...animals: string[]): Article {
	return {
		id: `${String(n).padStart(8, "0")}-0000-0000-0000-000000000000`,
		title: `About ${animals.join(" and ")} ${n}`,
		siteName: null,
		description: null,
		savedAt: "2026-10-01T00:00:00Z",
		text: animals.map((a) => `A piece about ${a}.`).join(" "),
		manualTags: [],
	}
}

const id = (n: number) => article(n).id

/**
 * Jev says yes (0.9) when one of the article's animals appears in what it is asked about the topic,
 * and no (0.05) otherwise, unless the test scores it. Haiku answers each kind of request from the
 * test's script.
 */
function fakeModels(
	haiku: Record<string, (prompt: string) => unknown>,
	score?: (animals: string[], instructions: string) => number,
	reader: Record<string, (prompt: string) => unknown> = {},
) {
	const jevQuestions: string[] = []
	const haikuPurposes: string[] = []
	const models: Pick<Models, "haiku" | "jev" | "reader"> = {
		async haiku(purpose, input) {
			haikuPurposes.push(purpose)
			const answer = haiku[purpose]
			if (!answer) throw new Error(`Unexpected Haiku call: ${purpose}`)
			return answer(input.prompt) as never
		},
		async reader(purpose, input) {
			const answer = reader[purpose]
			if (!answer) throw new Error(`Unexpected reader call: ${purpose}`)
			return answer(input.prompt) as never
		},
		async jev(_purpose, state, questions) {
			const animals = ANIMALS.filter((a) => state.includes(`about ${a}.`))
			return Object.fromEntries(
				Object.entries(questions).map(([topicId, q]) => {
					jevQuestions.push(q.instructions)
					const yes = animals.some((a) => q.instructions.toLowerCase().includes(a))
					return [topicId, score ? score(animals, q.instructions) : yes ? 0.9 : 0.05]
				}),
			)
		},
	}
	return { models, jevQuestions, haikuPurposes }
}

const config = (overrides: Partial<Config> = {}): Config => ({
	...DEFAULT_CONFIG,
	bootstrapSize: 3,
	poolSize: 2,
	minNewTopicArticles: 2,
	maintainEvery: 1000,
	...overrides,
})

const cats = { name: "Cats", description: "Articles about cats.", reason: "two of them" }
const sortedInto = (sim: Simulation, id: string) =>
	(sim.assignments.get(id) ?? []).filter((a) => a.level === "applied").map((a) => a.topicId)

describe("the topics simulation", () => {
	it("waits for the first articles, then proposes topics and sorts the library into them", async () => {
		const { models, haikuPurposes } = fakeModels({ propose: () => ({ topics: [cats] }) })
		const sim = new Simulation(config(), models)
		await sim.arrive(article(1, "cats"))
		await sim.arrive(article(2, "cats"))
		expect(haikuPurposes).toEqual([])
		expect(sim.topics).toEqual([])

		await sim.arrive(article(3, "dogs"))
		expect(sim.topics.map((t) => t.name)).toEqual(["Cats"])
		expect(sortedInto(sim, article(1, "cats").id)).toEqual(["t1"])
		expect(sortedInto(sim, article(3, "dogs").id)).toEqual([])
		expect(sim.result("test").unsorted).toEqual([article(3, "dogs").id])
	})

	// After the first topics, a new one is asked for once `poolSize` more articles fit none: here
	// the first dog is unsorted at the proposal, so two more dogs must arrive.
	it("creates a topic once enough articles fit none, and sorts the whole library into it", async () => {
		const { models, haikuPurposes } = fakeModels({
			propose: () => ({ topics: [cats] }),
			grow: () => ({
				topics: [
					{
						name: "Dogs",
						description: "Articles about dogs.",
						articleIds: ["00000003", "00000004", "00000005"],
						reason: "three dogs",
					},
				],
				note: "dogs",
			}),
		})
		const sim = new Simulation(config(), models)
		await sim.arrive(article(1, "cats"))
		// Already in Cats when Dogs is created: it must get Dogs as well, and keep Cats.
		await sim.arrive(article(2, "cats", "dogs"))
		await sim.arrive(article(3, "dogs"))
		await sim.arrive(article(4, "dogs"))
		expect(haikuPurposes).toEqual(["propose"])
		await sim.arrive(article(5, "dogs"))
		expect(haikuPurposes).toEqual(["propose", "grow"])

		expect(sim.topics.map((t) => t.name)).toEqual(["Cats", "Dogs"])
		expect(sortedInto(sim, id(3))).toEqual(["t2"])
		expect(sortedInto(sim, id(2)).sort()).toEqual(["t1", "t2"])
		expect(sim.result("test").unsorted).toEqual([])
	})

	it("leaves articles unsorted when the proposed topic would hold too few of them", async () => {
		const { models } = fakeModels({
			propose: () => ({ topics: [cats] }),
			grow: () => ({
				topics: [{ name: "Dogs", description: "dogs", articleIds: ["00000003"], reason: "" }],
				note: "nothing shared",
			}),
		})
		const sim = new Simulation(config(), models)
		for (const [n, animal] of [
			[1, "cats"],
			[2, "cats"],
			[3, "dogs"],
			[4, "owls"],
			[5, "owls"],
		] as const)
			await sim.arrive(article(n, animal))

		expect(sim.topics.map((t) => t.name)).toEqual(["Cats"])
		expect(sim.events.at(-1)).toMatchObject({ type: "no-new-topic", note: "nothing shared" })
		expect(sim.result("test").unsorted).toHaveLength(3)
	})

	it("widens a topic's description to take unsorted articles in, keeping its name", async () => {
		const { models } = fakeModels({
			propose: () => ({ topics: [cats] }),
			grow: () => ({
				widen: [
					{
						topicId: "t1",
						description: "Articles about cats and dogs.",
						articleIds: ["00000003", "00000004"],
						reason: "pets",
					},
				],
				topics: [],
				note: "they are pets",
			}),
		})
		const sim = new Simulation(config({ widen: true }), models)
		for (const [n, animal] of [
			[1, "cats"],
			[2, "cats"],
			[3, "dogs"],
			[4, "dogs"],
			[5, "dogs"],
		] as const)
			await sim.arrive(article(n, animal))

		expect(sim.topics).toMatchObject([
			{ name: "Cats", description: "Articles about cats and dogs." },
		])
		expect(sortedInto(sim, article(4, "dogs").id)).toEqual(["t1"])
		expect(sim.events.some((e) => e.type === "widen")).toBe(true)
	})

	it("asks Jev the shelf question when configured", async () => {
		const main = fakeModels({ propose: () => ({ topics: [cats] }) })
		const shelf = fakeModels({ propose: () => ({ topics: [cats] }) })
		for (const [fake, question] of [
			[main, "main"],
			[shelf, "shelf"],
		] as const) {
			const sim = new Simulation(config({ question }), fake.models)
			for (const n of [1, 2, 3]) await sim.arrive(article(n, "cats"))
		}
		expect(main.jevQuestions[0]).toMatch(/^Is "Cats" one of the main subjects/)
		expect(shelf.jevQuestions[0]).toMatch(/^A reader keeps a shelf called "Cats"/)
	})

	it("refuses a new topic whose articles are not really in the pool", async () => {
		const { models } = fakeModels({
			propose: () => ({ topics: [cats] }),
			grow: () => ({
				topics: [
					{
						name: "Dogs",
						description: "Articles about dogs.",
						articleIds: ["00000003", "00000003", "99999999"],
						reason: "",
					},
				],
				note: "made up",
			}),
		})
		const sim = new Simulation(config(), models)
		for (const [n, animal] of [
			[1, "cats"],
			[2, "cats"],
			[3, "dogs"],
			[4, "dogs"],
			[5, "dogs"],
		] as const)
			await sim.arrive(article(n, animal))
		expect(sim.topics.map((t) => t.name)).toEqual(["Cats"])
	})

	it("counts an article a widened topic lets go as unsorted again", async () => {
		const { models } = fakeModels({
			// Named for neither animal: only its description says which articles belong.
			propose: () => ({
				topics: [{ name: "Pets", description: "Articles about cats.", reason: "" }],
			}),
			grow: () => ({
				widen: [
					{
						topicId: "t1",
						description: "Articles about dogs.",
						articleIds: ["00000003"],
						reason: "",
					},
				],
				topics: [],
				note: "",
			}),
		})
		const sim = new Simulation(config({ widen: true }), models)
		for (const [n, animal] of [
			[1, "cats"],
			[2, "cats"],
			[3, "dogs"],
			[4, "dogs"],
			[5, "dogs"],
		] as const)
			await sim.arrive(article(n, animal))
		expect(sortedInto(sim, id(1))).toEqual([])
		expect(sim.result("test").unsorted.sort()).toEqual([id(1), id(2)])
	})

	it("asks for the first topics again only after more articles, when none were proposed", async () => {
		const { models, haikuPurposes } = fakeModels({ propose: () => ({ topics: [] }) })
		const sim = new Simulation(config(), models)
		for (const n of [1, 2, 3, 4]) await sim.arrive(article(n, "cats"))
		expect(haikuPurposes).toEqual(["propose"])
		await sim.arrive(article(5, "cats"))
		expect(haikuPurposes).toEqual(["propose", "propose"])
	})

	it("applies at most the configured number of topics, and suggests the weaker ones", async () => {
		const owls = { name: "Owls", description: "Articles about owls.", reason: "" }
		const dogs = { name: "Dogs", description: "Articles about dogs.", reason: "" }
		const { models } = fakeModels(
			{ propose: () => ({ topics: [cats, dogs, owls] }) },
			// Owls is only ever a maybe; cats beat dogs.
			(animals, q) =>
				q.includes("owls")
					? 0.5
					: animals.some((a) => q.toLowerCase().includes(a))
						? q.includes("cats")
							? 0.95
							: 0.9
						: 0.05,
		)
		const sim = new Simulation(config({ maxTopicsPerArticle: 1 }), models)
		for (const n of [1, 2, 3]) await sim.arrive(article(n, "cats", "dogs", "owls"))
		expect(sim.assignments.get(id(1))).toMatchObject([
			{ topicId: "t1", level: "applied" },
			{ topicId: "t2", level: "suggested" },
			{ topicId: "t3", level: "suggested", p: 0.5 },
		])
	})

	it("sorts with Haiku when it is the classifier", async () => {
		const { models, jevQuestions } = fakeModels({
			propose: () => ({ topics: [cats] }),
			sort: (prompt) => ({
				scores: [
					{
						topicId: "t1",
						probability: prompt.includes("<article>\nTitle: About cats") ? 0.9 : 0.1,
					},
				],
			}),
		})
		const sim = new Simulation(config({ classifier: "haiku" }), models)
		for (const [n, animal] of [
			[1, "cats"],
			[2, "cats"],
			[3, "dogs"],
		] as const)
			await sim.arrive(article(n, animal))
		expect(jevQuestions).toEqual([])
		expect(sortedInto(sim, id(1))).toEqual(["t1"])
		expect(sortedInto(sim, id(3))).toEqual([])
	})
})

describe("the review of topics", () => {
	const dogs = { name: "Dogs", description: "Articles about dogs.", reason: "" }
	const arrivals = [
		[1, "cats"],
		[2, "dogs"],
		[3, "owls"],
		[4, "cats"],
	] as const

	it("merges topics and sorts the whole library into the merged one", async () => {
		const { models } = fakeModels({
			propose: () => ({ topics: [cats, dogs] }),
			maintain: () => ({
				changes: [
					{
						op: "merge",
						topicIds: ["t1", "t2"],
						into: [{ name: "Pets", description: "Articles about cats, dogs and owls." }],
						reason: "pets",
					},
				],
				note: "",
			}),
		})
		const sim = new Simulation(config({ maintainEvery: 4 }), models)
		for (const [n, animal] of arrivals) await sim.arrive(article(n, animal))

		expect(sim.topics.filter((t) => t.retiredAt === undefined).map((t) => t.name)).toEqual(["Pets"])
		// The owl was in neither merged topic; the merged one holds it.
		expect(sortedInto(sim, id(3))).toEqual(["t3"])
		expect(sortedInto(sim, id(2))).toEqual(["t3"])
		expect(sim.result("test").unsorted).toEqual([])
	})

	it("splits a topic and sorts the whole library into its parts", async () => {
		const { models } = fakeModels({
			propose: () => ({ topics: [{ name: "Pets", description: "Articles about cats and dogs." }] }),
			maintain: () => ({
				changes: [
					{
						op: "split",
						topicIds: ["t1"],
						into: [
							{ name: "Cats", description: "Articles about cats." },
							{ name: "Birds", description: "Articles about owls." },
						],
						reason: "too mixed",
					},
				],
				note: "",
			}),
		})
		const sim = new Simulation(config({ maintainEvery: 4 }), models)
		for (const [n, animal] of arrivals) await sim.arrive(article(n, animal))

		expect(sortedInto(sim, id(1))).toEqual(["t2"])
		expect(sortedInto(sim, id(3))).toEqual(["t3"])
		expect(sim.result("test").unsorted).toEqual([id(2)])
	})

	it("renames a topic and sorts the whole library against its new description", async () => {
		const { models } = fakeModels({
			propose: () => ({ topics: [cats] }),
			maintain: () => ({
				changes: [
					{
						op: "rename",
						topicIds: ["t1"],
						into: [{ name: "Pets", description: "Articles about cats and dogs." }],
						reason: "",
					},
				],
				note: "",
			}),
		})
		const sim = new Simulation(config({ maintainEvery: 4 }), models)
		for (const [n, animal] of arrivals) await sim.arrive(article(n, animal))

		expect(sim.topics).toMatchObject([{ id: "t1", name: "Pets", renamedFrom: ["Cats"] }])
		expect(sortedInto(sim, id(2))).toEqual(["t1"])
	})

	it("retires every topic it names, and records each one", async () => {
		const { models } = fakeModels({
			propose: () => ({ topics: [cats, dogs] }),
			maintain: () => ({
				changes: [{ op: "retire", topicIds: ["t1", "t2"], into: [], reason: "stale" }],
				note: "",
			}),
		})
		const sim = new Simulation(config({ maintainEvery: 4 }), models)
		for (const [n, animal] of arrivals) await sim.arrive(article(n, animal))

		expect(sim.topics.every((t) => t.retiredAt === 4)).toBe(true)
		expect(sim.events.at(-1)).toMatchObject({
			type: "maintenance",
			ops: [{ op: "retire", topicIds: ["t1", "t2"] }],
		})
		expect(sortedInto(sim, id(1))).toEqual([])
		expect(sim.result("test").unsorted).toHaveLength(4)
	})
})

describe("a simulated reader", () => {
	const dogs = { name: "Dogs", description: "Articles about dogs.", reason: "" }
	const pets = { name: "Pets", description: "Articles about cats and dogs.", reason: "" }
	const arrivals = [
		[1, "cats"],
		[2, "dogs"],
		[3, "cats"],
		[4, "dogs"],
	] as const
	const reading = (overrides: Partial<Config> = {}) =>
		config({ reader: true, attention: 1, readerEvery: 4, maintainEvery: 4, ...overrides })
	/** The reader looks for an article on a topic when its name names the article's animal. */
	const judge = (prompt: string) => {
		const animal = /Title: About (\w+)/.exec(prompt)![1]!
		const ids = [...prompt.matchAll(/^- (t\d+): ([^:]+):/gm)]
			.filter(([, , name]) => name!.toLowerCase().includes(animal))
			.map(([, ref]) => ref!)
		return { topicIds: ids }
	}
	const none = () => ({ change: { op: "none", topicId: "", name: "" } })
	const noChange = () => ({ changes: [], note: "" })

	it("takes articles out of a topic where it would not look for them", async () => {
		const { models } = fakeModels(
			{
				propose: () => ({ topics: [pets] }),
				maintain: noChange,
				grow: () => ({ topics: [], note: "" }),
			},
			undefined,
			{ judge, tidy: none },
		)
		const sim = new Simulation(reading({ readerEvery: 3 }), models)
		for (const [n, animal] of arrivals) await sim.arrive(article(n, animal))

		// The reader looks for nothing on "Pets": every article is taken out of it.
		expect(sortedInto(sim, id(1))).toEqual([])
		expect(sim.refusals.map((r) => r.articleId).sort()).toEqual([id(1), id(2), id(3)].sort())
	})

	it("never lets a review rename, merge, split or retire a topic the reader named", async () => {
		const { models } = fakeModels(
			{
				propose: () => ({ topics: [cats, dogs] }),
				maintain: () => ({
					changes: [
						{
							op: "rename",
							topicIds: ["t1"],
							into: [{ name: "Kittens", description: "Articles about kittens.", boundary: "" }],
							reason: "",
						},
						{ op: "merge", topicIds: ["t1", "t2"], into: [pets], reason: "" },
						{ op: "retire", topicIds: ["t1"], into: [], reason: "" },
					],
					note: "",
				}),
			},
			undefined,
			{
				judge,
				tidy: (prompt) =>
					prompt.includes("proposes")
						? { change: { op: "rename", topicId: "t1", name: "Cats of mine" } }
						: none(),
			},
		)
		const sim = new Simulation(reading({ readerEvery: 1000 }), models)
		for (const [n, animal] of arrivals) await sim.arrive(article(n, animal))

		expect(sim.topics.filter((t) => t.retiredAt === undefined)).toMatchObject([
			{
				id: "t1",
				name: "Cats of mine",
				namedByReader: true,
				description: "Articles about kittens.",
			},
			{ id: "t2", name: "Dogs" },
		])
	})

	it("never brings back the name of a topic the reader removed", async () => {
		const { models } = fakeModels(
			{
				propose: () => ({ topics: [pets, dogs] }),
				maintain: () => ({
					changes: [
						{
							op: "split",
							topicIds: ["t1"],
							into: [
								{ name: "Cats", description: "Articles about cats.", boundary: "" },
								{ name: "dogs", description: "Articles about dogs.", boundary: "" },
							],
							reason: "",
						},
					],
					note: "",
				}),
			},
			undefined,
			{
				judge: () => ({ topicIds: ["t1", "t2"] }),
				tidy: (prompt) =>
					prompt.includes("proposes")
						? { change: { op: "remove", topicId: "t2", name: "" } }
						: none(),
			},
		)
		const sim = new Simulation(reading({ readerEvery: 1000 }), models)
		for (const [n, animal] of arrivals) await sim.arrive(article(n, animal))

		// A split needs two new topics: with "dogs" refused, it does not happen.
		expect(sim.topics.filter((t) => t.retiredAt === undefined).map((t) => t.name)).toEqual(["Pets"])
		expect(sim.topics.find((t) => t.id === "t2")).toMatchObject({ removed: true })
	})

	it("keeps an article out of what replaces a topic the reader took it out of", async () => {
		const { models } = fakeModels(
			{
				propose: () => ({ topics: [cats, dogs] }),
				maintain: () => ({
					changes: [{ op: "merge", topicIds: ["t1", "t2"], into: [pets], reason: "" }],
					note: "",
				}),
			},
			undefined,
			{
				judge: (prompt) => (prompt.includes("About cats 1") ? { topicIds: [] } : judge(prompt)),
				tidy: none,
			},
		)
		const sim = new Simulation(reading(), models)
		for (const [n, animal] of arrivals) await sim.arrive(article(n, animal))

		expect(sim.topics.find((t) => t.name === "Pets")).toBeDefined()
		expect(sortedInto(sim, id(1))).toEqual([])
		expect(sortedInto(sim, id(3))).toEqual(["t3"])
	})

	it("audits the final topics: how many placements the reader agrees with, and finds", async () => {
		const { models } = fakeModels(
			{ propose: () => ({ topics: [pets] }) },
			undefined,
			// Cats only: the dogs are on Pets, but the reader would not look for them there.
			{ audit: (prompt) => ({ topicIds: prompt.includes("About cats") ? ["t1"] : [] }) },
		)
		const sim = new Simulation(config(), models)
		for (const [n, animal] of arrivals) await sim.arrive(article(n, animal))

		expect(await sim.audit()).toMatchObject({ applied: 4, agreed: 2, wanted: 2, found: 2 })
	})
})
