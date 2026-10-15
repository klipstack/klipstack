import type { LanguageModelV4StreamPart } from "@ai-sdk/provider"
import { simulateReadableStream } from "ai"
import { MockLanguageModelV4 } from "ai/test"
import type { AnswerInput, BriefInput } from "./types"

/** Put in a question, makes the fake fail like a provider that broke off. */
export const FAKE_FAIL = "[fake:fail]"
/** Put in a question, makes the fake decline to answer. */
export const FAKE_REFUSE = "[fake:refuse]"

/**
 * A model that streams a fixed answer citing the passage itself, in a few pieces, as a provider
 * with document citations would. The answer counts the reader's turns, so a follow-up's answer
 * differs from the first.
 */
export function fakeModel(input: AnswerInput) {
	const { turns } = input.thread
	// A chat has no passage: it cites the article's first sentence, as the brief does.
	const passage =
		input.thread.action === "chat" ? firstSentence(input.article.text) : input.thread.passage
	const asked = turns.at(-1)?.text ?? ""
	const answers = turns.filter((t) => t.role === "user").length
	const usage = {
		inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
		outputTokens: { total: 20, text: 20, reasoning: 0 },
	}
	const text = (delta: string) => ({ type: "text-delta" as const, id: "t", delta })
	const chunks: LanguageModelV4StreamPart[] = asked.includes(FAKE_FAIL)
		? [
				{ type: "text-start" as const, id: "t" },
				text("**This answer"),
				{ type: "error" as const, error: new Error("fake provider failure") },
			]
		: asked.includes(FAKE_REFUSE)
			? [
					{ type: "text-start" as const, id: "t" },
					text("I can't help with that."),
					{ type: "text-end" as const, id: "t" },
					{
						type: "finish" as const,
						usage,
						finishReason: { unified: "content-filter" as const, raw: "refusal" },
					},
				]
			: [
					{ type: "text-start" as const, id: "t" },
					text("**A fixed answer for tests.** "),
					text("It draws on the passage"),
					{
						type: "source" as const,
						sourceType: "document" as const,
						id: "c1",
						mediaType: "text/plain",
						title: input.article.title,
						providerMetadata: {
							anthropic: {
								citedText: passage.exact,
								startCharIndex: passage.start,
								endCharIndex: passage.end,
							},
						},
					},
					text(` and nothing else. Answer ${answers}.`),
					{ type: "text-end" as const, id: "t" },
					{
						type: "finish" as const,
						usage,
						finishReason: { unified: "stop" as const, raw: "end_turn" },
					},
				]
	return new MockLanguageModelV4({
		provider: "fake",
		modelId: "fixed",
		doStream: async () => ({
			stream: simulateReadableStream({ chunks, chunkDelayInMs: 30 }),
		}),
	})
}

/** A fixed brief: three bullets, the first citing the article's first sentence. */
function firstSentence(text: string) {
	const end = text.search(/[.!?](\s|$)/)
	const exact = text.slice(0, end < 0 ? Math.min(text.length, 80) : end + 1)
	return { exact, start: 0, end: exact.length }
}

/** How long the demo's model thinks before its first word, as a provider does. */
export const DEMO_THINK_MS = 3000

/** The brief, after `thinkMs` (the demo's pause) before its first word. */
export function fakeBrief(input: BriefInput, thinkMs = 0) {
	const first = firstSentence(input.article.text).exact
	const usage = {
		inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
		outputTokens: { total: 30, text: 30, reasoning: 0 },
	}
	const delta = (d: string) => ({ type: "text-delta" as const, id: "t", delta: d })
	const cite = {
		type: "source" as const,
		sourceType: "document" as const,
		id: "c1",
		mediaType: "text/plain",
		title: input.article.title,
		providerMetadata: {
			anthropic: { citedText: first, startCharIndex: 0, endCharIndex: first.length },
		},
	}
	// An article titled with `[fake:fail]` breaks off, as a provider can.
	const failing: LanguageModelV4StreamPart[] = [
		{ type: "text-start" as const, id: "t" },
		delta("The gist"),
		{ type: "error" as const, error: new Error("fake provider failure") },
	]
	const chunks: LanguageModelV4StreamPart[] = input.article.title.includes(FAKE_FAIL)
		? failing
		: [
				{ type: "text-start" as const, id: "t" },
				delta("The gist of a fixed brief for tests. Why it matters.\n\n## Key claims\n\n"),
				delta("1. The first claim of a fixed brief for tests."),
				cite,
				delta("\n2. A second claim.\n\n## Keep in mind\n\n- A caveat."),
				delta("\n\n## Parts\n\n- **Opening**: where it starts."),
				cite,
				delta("\n- **The rest**: what follows."),
				{ type: "text-end" as const, id: "t" },
				{
					type: "finish" as const,
					usage,
					finishReason: { unified: "stop" as const, raw: "end_turn" },
				},
			]
	return new MockLanguageModelV4({
		provider: "fake",
		modelId: "fixed",
		doStream: async () => ({
			stream: simulateReadableStream({ chunks, initialDelayInMs: thinkMs, chunkDelayInMs: 30 }),
		}),
	})
}

/** The article's sentences with where each starts, skipping the very short ones. */
function sentences(text: string) {
	const out: Array<{ exact: string; start: number; end: number }> = []
	const pattern = /[^.!?\n]+[.!?]/g
	for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
		const lead = match[0].length - match[0].trimStart().length
		const exact = match[0].trim()
		if (exact.length >= 60 && exact.length <= 260)
			out.push({ exact, start: match.index + lead, end: match.index + lead + exact.length })
	}
	return out
}

/**
 * The demo app's model: an answer of two short paragraphs that reads like a real one, citing three
 * of the article's sentences (from its start, middle and end), streamed word by word after
 * `DEMO_THINK_MS`.
 */
export function fakeDemoModel(input: AnswerInput) {
	const all = sentences(input.article.text)
	const picks = [all[0], all[Math.floor(all.length / 2)], all.at(-1)].filter(
		(s, i, list): s is NonNullable<typeof s> => !!s && list.indexOf(s) === i,
	)
	const usage = {
		inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
		outputTokens: { total: 80, text: 80, reasoning: 0 },
	}
	const parts: LanguageModelV4StreamPart[] = [{ type: "text-start", id: "t" }]
	const say = (words: string) => {
		for (const word of words.split(/(?<= )/))
			parts.push({ type: "text-delta", id: "t", delta: word })
	}
	const cite = (n: number) => {
		const s = picks[n]
		if (!s) return
		parts.push({
			type: "source",
			sourceType: "document",
			id: `c${n}`,
			mediaType: "text/plain",
			title: input.article.title,
			providerMetadata: {
				anthropic: { citedText: s.exact, startCharIndex: s.start, endCharIndex: s.end },
			},
		})
	}
	say("The article sets out its argument early: the opening frames the question it means to answer")
	cite(0)
	say(". From there it builds its case step by step, and the *middle* is where it is most direct")
	cite(1)
	say(".\n\nIt closes by coming back to that opening, now with an answer of its own")
	cite(2)
	say(". **In short:** read the beginning and the end together.")
	parts.push(
		{ type: "text-end", id: "t" },
		{ type: "finish", usage, finishReason: { unified: "stop", raw: "end_turn" } },
	)
	return new MockLanguageModelV4({
		provider: "fake",
		modelId: "demo",
		doStream: async () => ({
			stream: simulateReadableStream({
				chunks: parts,
				initialDelayInMs: DEMO_THINK_MS,
				chunkDelayInMs: 40,
			}),
		}),
	})
}
