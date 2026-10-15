import { describe, expect, it } from "vitest"
import {
	AiError,
	type AnswerEvent,
	type AnswerInput,
	briefMessages,
	buildMessages,
	createAi,
	FAKE_FAIL,
	FAKE_REFUSE,
	systemPrompt,
} from "./index"

const text =
	"Makers need long blocks of time. Managers work in one hour slots. Meetings cost makers more."
const passage = { exact: "one hour slots", start: text.indexOf("one hour"), end: 0 }
passage.end = passage.start + passage.exact.length

function input(turns: AnswerInput["thread"]["turns"], action: "explain" | "ask" = "explain") {
	return {
		tier: "quick",
		article: { title: "Schedules", author: "PG", siteName: "paulgraham.com", text },
		thread: { action, passage, turns },
		language: "en",
	} satisfies AnswerInput
}

async function collect(events: AsyncIterable<AnswerEvent>) {
	const out: AnswerEvent[] = []
	for await (const event of events) out.push(event)
	return out
}

describe("prompt", () => {
	it("sends the same system prompt and article bytes for every question on a version", () => {
		const a = buildMessages(input([{ role: "user", text: "" }]))
		const b = buildMessages(
			input(
				[
					{ role: "user", text: "Why slots?" },
					{ role: "assistant", text: "Because." },
					{ role: "user", text: "And then?" },
				],
				"ask",
			),
		)
		const article = (messages: typeof a) => JSON.stringify((messages[0]!.content as unknown[])[0])
		expect(article(a)).toBe(article(b))
		expect(article(a)).toContain('"citations":{"enabled":true}')
		expect(systemPrompt("en")).toBe(systemPrompt("en"))
		expect(systemPrompt("es")).toContain("Answer in Spanish")
		expect(b).toHaveLength(3)
		expect(JSON.stringify(b[0])).toContain("Question: Why slots?")
	})
})

describe("answer, with the fake model", () => {
	const ai = createAi({ fake: true })

	it("streams text and a citation right after the words it supports", async () => {
		const answer = ai.answer(input([{ role: "user", text: "" }]))
		const events = await collect(answer.events)
		const result = await answer.done
		const citation = events.find((e) => e.type === "citation")
		expect(citation).toEqual({
			type: "citation",
			citation: { ...passage, at: "**A fixed answer for tests.** It draws on the passage".length },
		})
		expect(result).toMatchObject({
			status: "done",
			text: "**A fixed answer for tests.** It draws on the passage and nothing else. Answer 1.",
			citations: [citation!.citation],
			usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0 },
			model: "fake:fixed",
		})
	})

	it("says so when the model declines", async () => {
		const answer = ai.answer(input([{ role: "user", text: FAKE_REFUSE }], "ask"))
		await collect(answer.events)
		expect((await answer.done).status).toBe("refused")
	})

	it("fails with AiError when the provider breaks off", async () => {
		const answer = ai.answer(input([{ role: "user", text: FAKE_FAIL }], "ask"))
		await expect(collect(answer.events)).rejects.toBeInstanceOf(AiError)
		await expect(answer.done).rejects.toMatchObject({ reason: "provider" })
	})

	it("fails as aborted when cancelled", async () => {
		const controller = new AbortController()
		const answer = ai.answer({ ...input([{ role: "user", text: "" }]), signal: controller.signal })
		const read = collect(answer.events)
		controller.abort()
		await expect(read).rejects.toBeInstanceOf(AiError)
		await expect(answer.done).rejects.toMatchObject({ reason: "aborted" })
	})

	// The demo model thinks for three seconds before its first word, as a provider does.
	it("demo: cites the article's first, middle and last sentences, where they are", async () => {
		const sentences = [
			"Makers need long blocks of time to get anything hard done at all.",
			"Short. A single meeting can blow a whole afternoon for someone who makes things.",
			"Managers work in one hour slots, and their day is cut up to match it.",
			"So the two schedules clash, and the maker usually pays the cost of it.",
		]
		const article = { title: "Schedules", text: sentences.join(" ") }
		const answer = createAi({ fake: "demo" }).answer({
			...input([{ role: "user", text: "What is it about?" }], "ask"),
			article,
		})
		await collect(answer.events)
		const result = await answer.done
		const cited = [sentences[0]!, sentences[2]!, sentences[3]!].map((exact) => ({
			exact,
			start: article.text.indexOf(exact),
			end: article.text.indexOf(exact) + exact.length,
		}))
		expect(result.citations.map(({ exact, start, end }) => ({ exact, start, end }))).toEqual(cited)
		// Each citation sits right after the words it supports, before the sentence's full stop.
		for (const c of result.citations) expect(result.text[c.at]).toBe(".")
	}, 10_000)

	it("is unavailable without a key or the fake", () => {
		expect(createAi({}).available).toBe(false)
		expect(createAi({ anthropicApiKey: "k" }).available).toBe(true)
	})
})

describe("brief", () => {
	const article = { title: "Schedules", author: "PG", siteName: "paulgraham.com", text }

	it("sends the article as the same document the answers send, so the cache serves both", () => {
		const [brief] = briefMessages({ article, language: "en" })
		const [answer] = buildMessages(input([{ role: "user", text: "" }]))
		expect((brief!.content as unknown[])[0]).toEqual((answer!.content as unknown[])[0])
	})

	it("writes three bullets citing the article", async () => {
		const brief = createAi({ fake: true }).brief({ article, language: "en" })
		const events = await collect(brief.events)
		const result = await brief.done
		expect(result.text.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(3)
		expect(events.filter((e) => e.type === "citation")).toHaveLength(1)
		expect(result.citations[0]).toMatchObject({
			start: 0,
			exact: "Makers need long blocks of time.",
		})
	})
})
