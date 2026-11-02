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
	FAKE_SOURCES,
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
		expect(article(a)).toContain(
			"[1] Makers need long blocks of time.\\n[2] Managers work in one hour slots.\\n[3] Meetings",
		)
		expect(JSON.stringify(a[0])).toContain("The passage (in sentence 2)")
		const across = { exact: "slots. Meetings", start: text.indexOf("slots."), end: 0 }
		across.end = across.start + across.exact.length
		const [both] = buildMessages({
			...input([{ role: "user", text: "" }]),
			thread: { action: "explain", passage: across, turns: [{ role: "user", text: "" }] },
		})
		expect(JSON.stringify(both)).toContain("The passage (in sentences 2 to 3)")
		expect(systemPrompt("en")).toBe(systemPrompt("en"))
		expect(systemPrompt("es")).toContain("Answer in Spanish")
		expect(b).toHaveLength(3)
		expect(JSON.stringify(b[0])).toContain("Question: Why slots?")
	})
})

describe("answer, with the fake model", () => {
	const ai = createAi({ fake: true })

	it("streams text and a citation of the passage's sentence right after its words", async () => {
		const answer = ai.answer(input([{ role: "user", text: "" }]))
		const events = await collect(answer.events)
		const result = await answer.done
		const citation = events.find((e) => e.type === "citation")
		const sentence = "Managers work in one hour slots."
		expect(citation).toEqual({
			type: "citation",
			citation: {
				exact: sentence,
				start: text.indexOf(sentence),
				end: text.indexOf(sentence) + sentence.length,
				at: "**A fixed answer for tests.** It draws on the passage".length,
			},
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

describe("fact check, with the fake model", () => {
	const check = (turns: AnswerInput["thread"]["turns"]) =>
		({
			...input(turns),
			tier: "check",
			thread: { action: "check", passage, turns },
		}) satisfies AnswerInput

	it("says what it searches for, and keeps only the pages it cites, after their words", async () => {
		const answer = createAi({ fake: true }).answer(check([{ role: "user", text: "" }]))
		const events = await collect(answer.events)
		const result = await answer.done
		expect(events[0]).toEqual({ type: "search", query: "fixed fact check" })
		const verdict = "**Partly supported: a fixed check.**"
		const finding = "A study found otherwise."
		expect(result.text).toBe(`Checked: the passage\n\n${verdict} ${finding}`)
		// The uncited search result is not among them.
		expect(result.sources).toEqual([
			{ ...FAKE_SOURCES[0], at: result.text.indexOf(verdict) + verdict.length },
			{ ...FAKE_SOURCES[1], at: result.text.length },
		])
		expect(events.filter((e) => e.type === "source").map((e) => e.source)).toEqual(result.sources)
		// The article's sentences are still cited by their markers.
		expect(result.citations).toEqual([
			expect.objectContaining({ exact: "Managers work in one hour slots." }),
		])
		expect(result.usage.searches).toBe(1)
	})

	it("fails with AiError when the provider breaks off after a search", async () => {
		const answer = createAi({ fake: true }).answer(check([{ role: "user", text: FAKE_FAIL }]))
		await expect(collect(answer.events)).rejects.toBeInstanceOf(AiError)
	})
})

describe("brief", () => {
	const article = { title: "Schedules", author: "PG", siteName: "paulgraham.com", text }

	it("sends the article as the same document the answers send, so the cache serves both", () => {
		const [brief] = briefMessages({ article, language: "en" })
		const [answer] = buildMessages(input([{ role: "user", text: "" }]))
		expect((brief!.content as unknown[])[0]).toEqual((answer!.content as unknown[])[0])
	})

	it("writes a gist, then claims, caveats and parts, citing the article", async () => {
		const brief = createAi({ fake: true }).brief({ article, language: "en" })
		const events = await collect(brief.events)
		const result = await brief.done
		expect(result.text.match(/^## .+$/gm)).toEqual(["## Key claims", "## Keep in mind", "## Parts"])
		// The last ends the answer, a marker last of all.
		expect(events.filter((e) => e.type === "citation")).toHaveLength(3)
		expect(result.citations.at(-1)).toMatchObject({ exact: "Managers work in one hour slots." })
		expect(result.text.endsWith("- **The rest**: what follows.")).toBe(true)
		expect(result.citations[0]).toMatchObject({
			start: 0,
			exact: "Makers need long blocks of time.",
		})
	})
})
