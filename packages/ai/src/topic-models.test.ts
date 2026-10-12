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
	const sent: { system: string; prompt: string; format: unknown }[] = []
	const fetch = (async (_url: string, init: RequestInit) => {
		const body = JSON.parse(String(init.body))
		sent.push({
			system: body.system[0].text,
			prompt: body.messages[0].content[0].text,
			format: body.output_config?.format?.type,
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

	it("map a growth's refs back to ids, and drop topics holding too few real pool articles", async () => {
		const { fetch } = anthropic({
			widen: [
				{ topicId: "t1", description: "Wider.", articleIds: ["a1", "a9"], reason: "" },
				{ topicId: "t7", description: "Unknown topic.", articleIds: ["a1"], reason: "" },
			],
			topics: [
				{ name: "Kept", description: "d", articleIds: ["a1", "a2", "a3"], reason: "" },
				{ name: "Repeats", description: "d", articleIds: ["a1", "a1", "a1"], reason: "" },
				{ name: "Invents", description: "d", articleIds: ["a1", "a2", "a8"], reason: "" },
			],
			note: "n",
		})
		const result = await createTopicModels({ ...keys, fetch }).grow({
			topics: [{ id: "topic-uuid", name: "Writing", description: "On writing." }],
			pool: [article("x1", "One"), article("x2", "Two"), article("x3", "Three")],
			language: "en",
		})
		expect(result.value.widen).toEqual([
			{ topicId: "topic-uuid", description: "Wider.", articleIds: ["x1"], reason: "" },
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
				{ id: "A", name: "Alpha", description: "a", articles: 3, lastAt: 12, titles: ["x"] },
				{ id: "B", name: "Beta", description: "b", articles: 1, lastAt: 2, titles: ["y"] },
			],
			pairs: [{ a: "A", b: "B", count: 2 }],
			language: "en",
		})
		expect(sent[0]!.prompt).toContain("Alpha + Beta: 2 articles")
		expect(result.value.changes.map((c) => c.topicIds)).toEqual([["B"], ["A"]])
	})

	it("ask Jev the shelf question, twenty topics at a time, and return scores by topic id", async () => {
		const { fetch, sent } = jev((q) => (q.includes('"Topic 3"') ? 0.8 : 0.1))
		const topics = Array.from({ length: 25 }, (_, i) => ({
			id: `id-${i + 1}`,
			name: `Topic ${i + 1}`,
			description: "d",
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
		const input = { article: article("x", "T"), topics: [{ id: "t", name: "T", description: "" }] }
		await expect(refused.sort(input)).rejects.toSatisfy((e) => !retryable(e))
		await expect(busy.sort(input)).rejects.toSatisfy((e) => retryable(e))
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
				{ id: "p", name: "Psyche", description: "" },
				{ id: "q", name: "Aeon", description: "" },
			],
		})
		expect(sorted.value).toEqual({ p: 0.9, q: 0.05 })
	})
})
