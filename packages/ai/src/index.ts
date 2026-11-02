import { createAnthropic } from "@ai-sdk/anthropic"
import { type LanguageModel, type ModelMessage, streamText, type ToolSet } from "ai"
import { DEMO_THINK_MS, fakeBrief, fakeCheck, fakeDemoModel, fakeModel } from "./fake"
import { citationReader } from "./markers"
import { type AiConfig, isConfigured, languageModel, TIERS } from "./models"
import {
	briefMessages,
	briefSystemPrompt,
	buildMessages,
	checkSystemPrompt,
	systemPrompt,
} from "./prompt"
import {
	AiError,
	type Answer,
	type AnswerEvent,
	type AnswerInput,
	type AnswerResult,
	type AiTier,
	type BriefInput,
	type Citation,
	type WebSource,
} from "./types"

export { citationRange } from "./citations"
export { FAKE_FAIL, FAKE_REFUSE, FAKE_SOURCES } from "./fake"
export { estimateCostUsd, type TokenCounts } from "./cost"
export * from "./topic-models"
export * from "./topics"
export { DecisionError, decide, decisionBody, JEV_MODEL } from "./typesafe"
export { type AiConfig, TIERS } from "./models"
export {
	briefMessages,
	briefSystemPrompt,
	buildMessages,
	checkSystemPrompt,
	systemPrompt,
} from "./prompt"
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
				fake: () =>
					input.thread.action === "check"
						? fakeCheck(input, config.fake === "demo" ? DEMO_THINK_MS : 0)
						: config.fake === "demo"
							? fakeDemoModel(input)
							: fakeModel(input),
				system:
					input.thread.action === "check"
						? checkSystemPrompt(input.language)
						: systemPrompt(input.language),
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
	/** The article text sent: citations are ranges of its sentences. */
	article: string
	signal?: AbortSignal
}

const WEB_SEARCH = "web_search"
/** Web sources kept of one answer at most, as `CITATIONS_MAX` for the article's. */
const SOURCES_MAX = 50

/**
 * The tier's web search, run by the provider. `webSearch_20250305`: with the later versions,
 * the model sent its searches through code execution, and none ran.
 */
function searchTools(config: AiConfig, tier: AiTier): ToolSet | undefined {
	const maxUses = TIERS[tier].searches
	if (!maxUses) return undefined
	// The fake's searches are parts of its stream; the tool only has to be there.
	const anthropic = createAnthropic({ apiKey: config.anthropicApiKey ?? "fake" })
	return { [WEB_SEARCH]: anthropic.tools.webSearch_20250305({ maxUses }) }
}

/** Streams a request's answer: its text, its citations as ranges of the article, then the result. */
function stream(config: AiConfig, input: Request): Answer {
	const { model, name } = languageModel(config, input.tier, input.fake)
	const result = streamText({
		model,
		tools: searchTools(config, input.tier),
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
		const sources: WebSource[] = []
		let searches = 0
		// The pages a block of text cites come with it; their chips go after its last word.
		let citing = new Map<string, string | null>()
		const reader = citationReader(input.article)
		const kept = (event: AnswerEvent) => {
			if (event.type === "text") text += event.text
			else if (event.type === "citation") citations.push(event.citation)
			return event
		}
		try {
			for await (const part of result.fullStream) {
				switch (part.type) {
					case "text-delta":
						for (const event of reader.push(part.text)) yield kept(event)
						break
					case "tool-call":
						// Run by the provider: the model's searches, as they start.
						if (part.toolName === WEB_SEARCH) {
							searches++
							const query = (part.input as { query?: unknown } | undefined)?.query
							if (typeof query === "string") yield { type: "search", query }
						}
						break
					case "source":
						// Every search result comes as a source too: only those the answer cites count.
						if (part.sourceType === "url" && part.providerMetadata?.anthropic?.citedText)
							citing.set(part.url, part.title ?? null)
						break
					case "text-end":
						// The block's last words may be held back as a possible marker (a figure, a date):
						// written first, so the chips go after them. A marker doesn't span blocks.
						if (citing.size) for (const event of reader.end()) yield kept(event)
						for (const [url, title] of citing) {
							// Untrusted output, capped as the article's citations are.
							if (sources.length >= SOURCES_MAX) break
							const source = { url, title, at: text.length }
							sources.push(source)
							yield { type: "source", source }
						}
						citing = new Map()
						break
					case "error":
						throw new AiError("provider", "The provider could not answer.", { cause: part.error })
					case "abort":
						throw new AiError("aborted", "The answer was cancelled.")
					case "finish": {
						for (const event of reader.end()) yield kept(event)
						const usage = part.totalUsage
						resolve({
							status: part.finishReason === "content-filter" ? "refused" : "done",
							text,
							citations,
							sources,
							usage: {
								inputTokens: usage.inputTokens ?? 0,
								outputTokens: usage.outputTokens ?? 0,
								cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
								...(searches ? { searches } : {}),
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
