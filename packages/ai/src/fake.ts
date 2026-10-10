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

export function fakeBrief(input: BriefInput) {
	const first = firstSentence(input.article.text).exact
	const usage = {
		inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
		outputTokens: { total: 30, text: 30, reasoning: 0 },
	}
	const delta = (d: string) => ({ type: "text-delta" as const, id: "t", delta: d })
	// An article titled with `[fake:fail]` breaks off, as a provider can.
	const failing: LanguageModelV4StreamPart[] = [
		{ type: "text-start" as const, id: "t" },
		delta("- The first"),
		{ type: "error" as const, error: new Error("fake provider failure") },
	]
	const chunks: LanguageModelV4StreamPart[] = input.article.title.includes(FAKE_FAIL)
		? failing
		: [
				{ type: "text-start" as const, id: "t" },
				delta("- The first point of a fixed brief for tests."),
				{
					type: "source" as const,
					sourceType: "document" as const,
					id: "c1",
					mediaType: "text/plain",
					title: input.article.title,
					providerMetadata: {
						anthropic: { citedText: first, startCharIndex: 0, endCharIndex: first.length },
					},
				},
				delta("\n- A second point."),
				delta("\n- A third point."),
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
		doStream: async () => ({ stream: simulateReadableStream({ chunks, chunkDelayInMs: 30 }) }),
	})
}
