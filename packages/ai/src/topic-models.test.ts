import { describe, expect, it } from "vitest"
import { createTopicModels, retryable, TOPIC_RULES } from "./index"

const article = (id: string, title: string, siteName: string | null = null) => ({
	id,
	title,
	siteName,
	description: null,
	text: `${title}. Some text.`,
})

/** Answers Anthropic's requests with `answer` as the JSON text, and keeps what was sent. */
function anthropic(answer: unknown) {
	const sent: { system: string; prompt: string; format: unknown; schema: unknown }[] = []
	const fetch = (async (_url: string, init: RequestInit) => {
		const body = JSON.parse(String(init.body))
		sent.push({
			system: body.system[0].text,
			prompt: body.messages[0].content[0].text,
			format: body.output_config?.format?.type,
			schema: body.output_config?.format?.schema,
		})
		return Response.json({
			id: "m",
			type: "message",
			role: "assistant",
			model: "claude-haiku-5-5",
			content: [{ type: "text", text: JSON.stringify(answer) }],
			stop_reason: "end_turn",
			usage: { input_tokens: 500, output_tokens: 80 },
		})
	}) as typeof globalThis.fetch
	return { fetch, sent }
}

/** Answers Jev's requests with `p` for every question, and keeps each request's question keys. */
function jev(p: (instructions: string) => number, status = 200) {
	const sent: string[][] = []
	const fetch = (async (_url: string, init: RequestInit) => {
		const body = JSON.parse(String(init.body))
		sent.push(Object.keys(body.questions))
		if (status !== 200) return new Response("no", { status })
		return Response.json({
			answers: Object.fromEntries(
				Object.entries(body.questions as Record<string, { instructions: string }>).map(
					([key, q]) => [key, { noul: p(q.instructions) }],
				),
			),
			usage: { input_tokens: 300, output_tokens: 10 },
		})
	}) as typeof globalThis.fetch
	return { fetch, sent }
}

const keys = { anthropicApiKey: "a", typesafeApiKey: "t" }

describe("the topic models", () => {
	it("are available only with both keys, or the fake", () => {
		expect(createTopicModels({ anthropicApiKey: "a" }).available).toBe(false)
		expect(createTopicModels({ typesafeApiKey: "t" }).available).toBe(false)
		expect(createTopicModels(keys).available).toBe(true)
		expect(createTopicModels({ fake: true }).available).toBe(true)
	})

	it("show Haiku short refs and the reader's language, never the app's ids", async () => {
		const { fetch, sent } = anthropic({ topics: [] })
		await createTopicModels({ ...keys, fetch }).propose({
			articles: [article("uuid-1", "On listening"), article("uuid-2", "On talking")],
			language: "es",
		})
		expect(sent[0]!.prompt).toContain("[a1] On listening")
		expect(sent[0]!.prompt).toContain("[a2] On talking")
		expect(sent[0]!.prompt).not.toContain("uuid-")
		expect(sent[0]!.system).toContain("in Spanish")
		expect(sent[0]!.format).toBe("json_schema")
	})

	it("ask for sections, about one for every eight articles, as production does", async () => {
		const { fetch, sent } = anthropic({ topics: [] })
		const articles = Array.from({ length: 80 }, (_, i) => article(`id-${i}`, `Article ${i}`))
		await createTopicModels({ ...keys, fetch }).propose({ articles, language: "en" })
		expect(TOPIC_RULES.style).toBe("sections")
		expect(sent[0]!.system).toContain("the way a bookstore is organized into sections")
		expect(sent[0]!.prompt).toContain("Propose the first sections of their library: about 10")
	})

	it("ask for at least 3 sections and at most 12, whatever the library's size", async () => {
		const asked = async (count: number) => {
			const { fetch, sent } = anthropic({ topics: [] })
			const articles = Array.from({ length: count }, (_, i) => article(`id-${i}`, `A ${i}`))
			await createTopicModels({ ...keys, fetch }).propose({ articles, language: "en" })
			return sent[0]!.prompt.match(/about (\d+), each/)?.[1]
		}
		// The first proposal comes at 25 articles; it reads at most the newest 200.
		expect(await asked(25)).toBe("3")
		expect(await asked(200)).toBe("12")
	})

	it("map a growth's refs back to ids, and drop topics holding too few real pool articles", async () => {
		const { fetch } = anthropic({
			widen: [
				{
					topicId: "t1",
					description: "Wider.",
					boundary: "Not B.",
					articleIds: ["a1", "a9"],
					reason: "",
				},
				{
					topicId: "t7",
					description: "Unknown topic.",
					boundary: "",
					articleIds: ["a1"],
					reason: "",
				},
			],
			topics: [
				{
					name: "Kept",
					description: "d",
					boundary: "b",
					articleIds: ["a1", "a2", "a3"],
					reason: "",
				},
				{
					name: "Repeats",
					description: "d",
					boundary: "b",
					articleIds: ["a1", "a1", "a1"],
					reason: "",
				},
				{
					name: "Invents",
					description: "d",
					boundary: "b",
					articleIds: ["a1", "a2", "a8"],
					reason: "",
				},
			],
			note: "n",
		})
		const result = await createTopicModels({ ...keys, fetch }).grow({
			topics: [
				{ id: "topic-uuid", name: "Writing", description: "On writing.", boundary: "Not poems." },
			],
			pool: [article("x1", "One"), article("x2", "Two"), article("x3", "Three")],
			language: "en",
		})
		expect(result.value.widen).toEqual([
			{
				topicId: "topic-uuid",
				description: "Wider.",
				boundary: "Not B.",
				articleIds: ["x1"],
				reason: "",
			},
		])
		expect(result.value.topics.map((t) => [t.name, t.articleIds])).toEqual([
			["Kept", ["x1", "x2", "x3"]],
		])
		expect(result.spend).toEqual([
			{
				model: "anthropic:claude-haiku-5-5",
				inputTokens: 500,
				outputTokens: 80,
				cacheReadTokens: 0,
			},
		])
	})

	it("map a review's topic refs back to ids and keep at most three changes", async () => {
		const change = (ref: string) => ({ op: "retire", topicIds: [ref], into: [], reason: "" })
		const { fetch, sent } = anthropic({
			changes: [change("t2"), change("t9"), change("t1"), change("t2"), change("t1")],
			note: "n",
		})
		const result = await createTopicModels({ ...keys, fetch }).review({
			libraryCount: 40,
			sortedCount: 30,
			unsortedCount: 10,
			topics: [
				{
					id: "A",
					name: "Alpha",
					description: "a.",
					boundary: "Not b.",
					articles: 3,
					lastAt: 12,
					titles: ["x"],
				},
				{
					id: "B",
					name: "Beta",
					description: "b",
					boundary: "",
					articles: 1,
					lastAt: 2,
					titles: ["y"],
				},
			],
			pairs: [{ a: "A", b: "B", count: 2 }],
			language: "en",
		})
		expect(sent[0]!.prompt).toContain("Alpha + Beta: 2 articles")
		expect(sent[0]!.prompt).toContain("Alpha (3 articles, last at 12): a. Not b.")
		expect(result.value.changes.map((c) => c.topicIds)).toEqual([["B"], ["A"]])
	})

	it("ask for new words for a renamed topic by ref, and map the answer back to its id", async () => {
		const { fetch, sent } = anthropic({
			topics: [
				{ topicId: "t1", description: "Programming languages.", boundary: "Not tools." },
				{ topicId: "t7", description: "Invented.", boundary: "" },
			],
		})
		const result = await createTopicModels({ ...keys, fetch }).reword({
			topics: [
				{ id: "A", name: "Programming Languages", description: "Building software.", boundary: "" },
			],
			others: [{ id: "B", name: "Startups", description: "Founding companies.", boundary: "" }],
			language: "en",
		})
		expect(sent[0]!.prompt).toContain('t1: now "Programming Languages": Building software.')
		expect(sent[0]!.prompt).toContain("- Startups: Founding companies.")
		expect(sent[0]!.prompt).not.toContain('"A"')
		expect(result.value).toEqual([
			{ topicId: "A", description: "Programming languages.", boundary: "Not tools." },
		])
	})

	it("ask Jev the shelf question, twenty topics at a time, and return scores by topic id", async () => {
		const { fetch, sent } = jev((q) => (q.includes('"Topic 3"') ? 0.8 : 0.1))
		const topics = Array.from({ length: 25 }, (_, i) => ({
			id: `id-${i + 1}`,
			name: `Topic ${i + 1}`,
			description: "d",
			boundary: "",
		}))
		const result = await createTopicModels({ ...keys, fetch }).sort({
			article: article("x", "Title"),
			topics,
		})
		expect(sent.map((keys) => keys.length)).toEqual([20, 5])
		expect(Object.keys(result.value)).toHaveLength(25)
		expect(result.value["id-3"]).toBe(0.8)
		expect(result.value["id-24"]).toBe(0.1)
		expect(result.spend).toHaveLength(2)
		expect(result.spend[0]).toMatchObject({ model: "typesafe:jev-1.13.0", inputTokens: 300 })
		expect(TOPIC_RULES.question).toBe("shelf")
	})

	it("tell a refused Jev request from one worth retrying", async () => {
		const refused = createTopicModels({ ...keys, fetch: jev(() => 0, 400).fetch })
		const busy = createTopicModels({ ...keys, fetch: jev(() => 0, 503).fetch })
		const input = {
			article: article("x", "T"),
			topics: [{ id: "t", name: "T", description: "", boundary: "" }],
		}
		await expect(refused.sort(input)).rejects.toSatisfy((e) => !retryable(e))
		await expect(busy.sort(input)).rejects.toSatisfy((e) => retryable(e))
	})

	it("ask Haiku for what readers see and what sorting needs as two fields", async () => {
		const { fetch, sent } = anthropic({
			topics: [
				{
					name: "Management",
					description: "Leading teams and running organizations.",
					boundary: "Questions about the mind belong in Psychology.",
					reason: "",
				},
			],
		})
		const result = await createTopicModels({ ...keys, fetch }).propose({
			articles: [article("1", "One"), article("2", "Two")],
			language: "en",
		})
		type Field = { description: string }
		const topic = (
			sent[0]!.schema as {
				properties: {
					topics: { items: { properties: Record<string, Field>; required: string[] } }
				}
			}
		).properties.topics.items
		expect(topic.properties.description!.description).toMatch(/reader/)
		expect(topic.properties.description!.description).not.toMatch(/what does not/)
		expect(topic.properties.boundary!.description).toMatch(/what does not/)
		expect(topic.required).toEqual(expect.arrayContaining(["description", "boundary"]))
		expect(result.value[0]).toMatchObject({
			description: "Leading teams and running organizations.",
			boundary: "Questions about the mind belong in Psychology.",
		})
	})

	it("show the models each topic's description with its boundary", async () => {
		const topic = {
			id: "w",
			name: "Writing",
			description: "On writing well.",
			boundary: "Poetry belongs in Literature.",
		}
		const haiku = anthropic({ widen: [], topics: [], note: "" })
		await createTopicModels({ ...keys, fetch: haiku.fetch }).grow({
			topics: [topic],
			pool: [article("x", "One")],
			language: "en",
		})
		expect(haiku.sent[0]!.prompt).toContain(
			"Writing: On writing well. Poetry belongs in Literature.",
		)
		const asked: string[] = []
		const { fetch } = jev((q) => {
			asked.push(q)
			return 0.5
		})
		await createTopicModels({ ...keys, fetch }).sort({
			article: article("a", "A"),
			topics: [topic],
		})
		expect(asked[0]).toContain("On writing well. Poetry belongs in Literature.")
		const main: string[] = []
		const mainJev = jev((q) => {
			main.push(q)
			return 0.5
		})
		await createTopicModels(
			{ ...keys, fetch: mainJev.fetch },
			{ ...TOPIC_RULES, question: "main" },
		).sort({ article: article("a", "A"), topics: [topic] })
		expect(main[0]).toContain("Writing: On writing well. Poetry belongs in Literature.")
	})

	it("fake: a description and a boundary in the reader's language", async () => {
		const models = createTopicModels({ fake: true })
		const articles = [article("1", "A", "Psyche"), article("2", "B", "Psyche")]
		const en = await models.propose({ articles, language: "en" })
		expect(en.value[0]).toMatchObject({
			description: "Articles from Psyche.",
			boundary: "Articles from other sites belong in their own topics.",
		})
		const es = await models.grow({ topics: [], pool: articles, language: "es" })
		expect(es.value.topics[0]).toMatchObject({
			description: "Artículos de Psyche.",
			boundary: "Los artículos de otros sitios van en sus propios temas.",
		})
	})

	it("fake: one topic per site articles share, and articles sorted by the topic's name", async () => {
		const models = createTopicModels({ fake: true })
		const proposed = await models.propose({
			articles: [
				article("1", "A", "Psyche"),
				article("2", "B", "Psyche"),
				article("3", "C", "Aeon"),
			],
			language: "en",
		})
		expect(proposed.value.map((t) => t.name)).toEqual(["Psyche"])
		const sorted = await models.sort({
			article: article("4", "D", "Psyche"),
			topics: [
				{ id: "p", name: "Psyche", description: "", boundary: "" },
				{ id: "q", name: "Aeon", description: "", boundary: "" },
			],
		})
		expect(sorted.value).toEqual({ p: 0.9, q: 0.05 })
	})
})
