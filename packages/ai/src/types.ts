/** What the reader asks of a passage; `chat` asks about the whole article (its passage is empty). */
export const AI_ACTIONS = ["explain", "define", "ask", "chat"] as const
export type AiAction = (typeof AI_ACTIONS)[number]

/** Quick answers a passage; deep (the whole-article box, later) may think longer. */
export type AiTier = "quick" | "deep"

export type AiLanguage = "en" | "es"

/**
 * A passage of the article an answer draws on: a range of the text it was given, and where in the
 * answer it was cited (`at`, a position in the answer's text), so the chip goes after those words.
 */
export interface Citation {
	start: number
	end: number
	exact: string
	at: number
}

export interface Turn {
	role: "user" | "assistant"
	text: string
}

export interface AnswerInput {
	tier: AiTier
	/** `text` is the article version's plain text: citations are ranges in it. */
	article: { title: string; author?: string | null; siteName?: string | null; text: string }
	thread: {
		action: AiAction
		/** Offsets in `article.text`. */
		passage: { exact: string; start: number; end: number }
		/**
		 * The conversation so far, oldest first, ending with the user's turn to answer. The first
		 * user turn is the question of an Ask; Explain and Define may leave it empty.
		 */
		turns: Turn[]
	}
	language: AiLanguage
	signal?: AbortSignal
}

export interface BriefInput {
	article: AnswerInput["article"]
	language: AiLanguage
	signal?: AbortSignal
}

export type AnswerEvent = { type: "text"; text: string } | { type: "citation"; citation: Citation }

export interface Usage {
	inputTokens: number
	outputTokens: number
	/** Input tokens read from the provider's cache, part of `inputTokens`. */
	cacheReadTokens: number
}

export interface AnswerResult {
	/** `refused`: the model declined to answer; `text` may hold what it said instead. */
	status: "done" | "refused"
	text: string
	citations: Citation[]
	usage: Usage
	/** `provider:model`, as the tier resolved it. */
	model: string
}

export interface Answer {
	/** The answer as it is written: text, and each citation right after the words it supports. */
	events: AsyncIterable<AnswerEvent>
	/** Settles once the stream ends. Rejects with `AiError` when it could not be answered. */
	done: Promise<AnswerResult>
}

/** Why an answer failed: the provider refused the call or broke off, or it was cancelled. */
export class AiError extends Error {
	readonly reason: "provider" | "aborted"
	constructor(reason: "provider" | "aborted", message: string, options?: { cause?: unknown }) {
		super(message, options)
		this.name = "AiError"
		this.reason = reason
	}
}
