import type { LanguageModelV4StreamPart } from "@ai-sdk/provider"
import { simulateReadableStream } from "ai"
import { MockLanguageModelV4 } from "ai/test"
import { sentences, sentencesIn } from "./sentences"
import type { AnswerInput, BriefInput } from "./types"

/** Put in a question, makes the fake fail like a provider that broke off. */
export const FAKE_FAIL = "[fake:fail]"
/** Put in a question, makes the fake decline to answer. */
export const FAKE_REFUSE = "[fake:refuse]"

/** Markers citing sentences, as the model writes them: ` [3][4]`. */
const markers = (numbers: number[]) => ` ${numbers.map((n) => `[${n}]`).join("")}`

/**
 * A model that streams a fixed answer citing the passage's sentences, in a few pieces, as the
 * model does. The answer counts the reader's turns, so a follow-up's answer differs from the first.
 */
export function fakeModel(input: AnswerInput) {
	const { turns } = input.thread
	const { start, end } = input.thread.passage
	// A chat has no passage: it cites the article's first sentence, as the brief does.
	const cited = input.thread.action === "chat" ? [1] : sentencesIn(input.article.text, start, end)
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
					text(markers(cited)),
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

/** How long the demo's model thinks before its first word, as a provider does. */
export const DEMO_THINK_MS = 3000

/**
 * A fixed brief in its sections, citing the article's first sentence twice, after `thinkMs`
 * (the demo's pause) before its first word.
 */
export function fakeBrief(input: BriefInput, thinkMs = 0) {
	const usage = {
		inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
		outputTokens: { total: 30, text: 30, reasoning: 0 },
	}
	const delta = (d: string) => ({ type: "text-delta" as const, id: "t", delta: d })
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
				delta(markers([1])),
				delta("\n2. A second claim.\n\n## Keep in mind\n\n- A caveat."),
				delta("\n\n## Parts\n\n- **Opening**: where it starts."),
				delta(markers([1])),
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

/**
 * The demo app's model: an answer of two short paragraphs that reads like a real one, citing three
 * of the article's sentences (from its start, middle and end), streamed word by word after
 * `DEMO_THINK_MS`.
 */
export function fakeDemoModel(input: AnswerInput) {
	// The article's sentences by number, skipping the very short and very long ones.
	const all = sentences(input.article.text).flatMap((s, i) =>
		s.text.length >= 60 && s.text.length <= 260 ? [i + 1] : [],
	)
	const picks = [all[0], all[Math.floor(all.length / 2)], all.at(-1)].filter(
		(n, i, list): n is number => n !== undefined && list.indexOf(n) === i,
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
		const pick = picks[n]
		if (pick) parts.push({ type: "text-delta", id: "t", delta: markers([pick]) })
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
