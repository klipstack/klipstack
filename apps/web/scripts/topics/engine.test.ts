import { describe, expect, it } from "vitest"
import { type Article, type Config, DEFAULT_CONFIG, Simulation } from "./engine"
import type { Models } from "./models"

const ANIMALS = ["cats", "dogs", "owls"]

function article(n: number, animal: string): Article {
	return {
		id: `${String(n).padStart(8, "0")}-0000-0000-0000-000000000000`,
		title: `About ${animal} ${n}`,
		siteName: null,
		description: null,
		savedAt: "2026-10-01T00:00:00Z",
		text: `A piece about ${animal}.`,
		manualTags: [],
	}
}

/**
 * Jev says yes (0.9) when the article's animal appears in what it is asked about the topic, and
 * no (0.05) otherwise. Haiku answers each kind of request from the test's script.
 */
function fakeModels(haiku: Record<string, (prompt: string) => unknown>) {
	const jevQuestions: string[] = []
	const haikuPurposes: string[] = []
	const models: Pick<Models, "haiku" | "jev"> = {
		async haiku(purpose, input) {
			haikuPurposes.push(purpose)
			const answer = haiku[purpose]
			if (!answer) throw new Error(`Unexpected Haiku call: ${purpose}`)
			return answer(input.prompt) as never
		},
		async jev(_purpose, state, questions) {
			const animal = ANIMALS.find((a) => state.includes(`about ${a}.`))
			return Object.fromEntries(
				Object.entries(questions).map(([id, q]) => {
					jevQuestions.push(q.instructions)
					return [id, animal && q.instructions.toLowerCase().includes(animal) ? 0.9 : 0.05]
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
		const { models } = fakeModels({
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
		for (const [n, animal] of [
			[1, "cats"],
			[2, "cats"],
			[3, "dogs"],
			[4, "dogs"],
			[5, "dogs"],
		] as const)
			await sim.arrive(article(n, animal))

		expect(sim.topics.map((t) => t.name)).toEqual(["Cats", "Dogs"])
		expect(sortedInto(sim, article(3, "dogs").id)).toEqual(["t2"])
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
})
