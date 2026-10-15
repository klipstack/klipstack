import { type LanguageModel, type ModelMessage, streamText } from "ai"
import { anthropicCitation, citationRange } from "./citations"
import { DEMO_THINK_MS, fakeBrief, fakeDemoModel, fakeModel } from "./fake"
import { type AiConfig, isConfigured, languageModel, TIERS } from "./models"
import { briefMessages, briefSystemPrompt, buildMessages, systemPrompt } from "./prompt"
import {
	AiError,
	type Answer,
	type AnswerEvent,
	type AnswerInput,
	type AnswerResult,
	type AiTier,
	type BriefInput,
	type Citation,
} from "./types"

export { citationRange } from "./citations"
export { FAKE_FAIL, FAKE_REFUSE } from "./fake"
export { estimateCostUsd, type TokenCounts } from "./cost"
export * from "./topic-models"
export * from "./topics"
export { DecisionError, decide, decisionBody, JEV_MODEL } from "./typesafe"
export { type AiConfig, TIERS } from "./models"
export { briefMessages, briefSystemPrompt, buildMessages, systemPrompt } from "./prompt"
export * from "./types"

/**
 * The AI module: the only code that knows about providers. The app asks for answers in its own
 * terms and gets text, citations as ranges of the article, and usage.
 */
export function createAi(config: AiConfig) {
	return {
		/** Whether answers can be asked for: a provider key, or the fake. */
		available: isConfigured(config),
		answer: (input: AnswerInput) =>
			stream(config, {
				tier: input.tier,
				fake: () => (config.fake === "demo" ? fakeDemoModel(input) : fakeModel(input)),
				system: systemPrompt(input.language),
				messages: buildMessages(input),
				article: input.article.text,
				signal: input.signal,
			}),
		/** A short cited summary of the whole article (the reader's brief). */
		brief: (input: BriefInput) =>
			stream(config, {
				tier: "quick",
				// Four sections, each cited: more than an answer, and a brief cut short is kept as it is.
				maxOutputTokens: 6144,
				fake: () => fakeBrief(input, config.fake === "demo" ? DEMO_THINK_MS : 0),
				system: briefSystemPrompt(input.language),
				messages: briefMessages(input),
				article: input.article.text,
				signal: input.signal,
			}),
	}
}

export type Ai = ReturnType<typeof createAi>

interface Request {
	tier: AiTier
	/** Instead of the tier's. */
	maxOutputTokens?: number
	/** The fake model for this request, used with `config.fake`. */
	fake: () => LanguageModel
	system: string
	messages: ModelMessage[]
	/** The article text sent: citations are checked against it. */
	article: string
	signal?: AbortSignal
}

/** Streams a request's answer: its text, its citations as ranges of the article, then the result. */
function stream(config: AiConfig, input: Request): Answer {
	const { model, name } = languageModel(config, input.tier, input.fake)
	const result = streamText({
		model,
		system: input.system,
		messages: input.messages,
		maxOutputTokens: input.maxOutputTokens ?? TIERS[input.tier].maxOutputTokens,
		abortSignal: input.signal,
		// Errors come through the stream, as `error` parts: handled below, not logged twice.
		onError: () => {},
	})

	let resolve!: (value: AnswerResult) => void
	let reject!: (reason: unknown) => void
	const done = new Promise<AnswerResult>((res, rej) => {
		resolve = res
		reject = rej
	})
	// Nobody may wait on it (a stream read to its end resolves it first); never unhandled.
	done.catch(() => {})

	async function* events(): AsyncGenerator<AnswerEvent> {
		let text = ""
		const citations: Citation[] = []
		try {
			for await (const part of result.fullStream) {
				switch (part.type) {
					case "text-delta":
						text += part.text
						yield { type: "text", text: part.text }
						break
					case "source": {
						if (part.sourceType !== "document") break
						const cited = anthropicCitation(part.providerMetadata)
						const citation = cited && citationRange(input.article, cited, text.length)
						if (
							citation &&
							!citations.some(
								(c) => c.start === citation.start && c.end === citation.end && c.at === citation.at,
							)
						) {
							citations.push(citation)
							yield { type: "citation", citation }
						}
						break
					}
					case "error":
						throw new AiError("provider", "The provider could not answer.", { cause: part.error })
					case "abort":
						throw new AiError("aborted", "The answer was cancelled.")
					case "finish": {
						const usage = part.totalUsage
						resolve({
							status: part.finishReason === "content-filter" ? "refused" : "done",
							text,
							citations,
							usage: {
								inputTokens: usage.inputTokens ?? 0,
								outputTokens: usage.outputTokens ?? 0,
								cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
							},
							model: name,
						})
						break
					}
				}
			}
			reject(new AiError("provider", "The answer ended without finishing."))
		} catch (error) {
			const failure =
				error instanceof AiError
					? error
					: input.signal?.aborted
						? new AiError("aborted", "The answer was cancelled.", { cause: error })
						: new AiError("provider", "The provider could not answer.", { cause: error })
			reject(failure)
			throw failure
		}
	}

	return { events: events(), done }
}
