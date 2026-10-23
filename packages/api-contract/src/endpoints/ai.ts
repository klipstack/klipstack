import { z } from "zod"
import { IN_APP_AI_CLIENTS } from "../auth"
import { defineEndpoint, empty, events, json, type OnlyClients } from "../endpoint"
import { NUL_REFUSED, QUESTION_MAX, QUOTE_MAX, withoutNul } from "../names"
import { Id, Time } from "../schemas"

/**
 * Questions about an article and its passages, answered by an AI model, and the article's brief.
 * Only for accounts with AI answers turned on, on a server with a provider set up (`GET /ai`).
 * Every question, follow-up, retry and new brief counts against the account's monthly cap,
 * whatever client sends it; answers stream as server-sent events. Spending the account's AI, and
 * changing its threads, is for our own apps with in-app AI only (`IN_APP_AI_CLIENTS`): the CLI
 * and other apps get `403 forbidden`. Reading what was answered already costs nothing, so
 * `GET /ai` and `GET /articles/:id/ai` answer every client.
 */

const params = z.object({ id: Id })

/** Who may spend the account's AI through the API. */
const inAppAi: OnlyClients = {
	ids: IN_APP_AI_CLIENTS,
	refusal: "Only Klipstack's own apps can use the account's AI. The CLI and other apps cannot.",
	audience: "Klipstack's own apps with in-app AI",
	note: "Whoever connects through the API brings their own AI.",
}

/** What the reader asks of a passage; `chat` asks about the whole article. */
export const AI_THREAD_ACTIONS = ["explain", "define", "ask", "chat"] as const

/** The account's AI questions this month, against its cap. */
export const AiAllowance = z
	.object({
		used: z.number().int().nonnegative(),
		max: z.number().int().nonnegative(),
		/** When the count starts over: the 1st of next month, UTC. */
		resetsAt: Time,
	})
	.meta({ id: "AiAllowance" })
export type AiAllowance = z.infer<typeof AiAllowance>

/**
 * A passage an answer draws on: offsets into the article's text (as `articles.html`'s and the
 * highlights'), its words, and where in the answer's text it is cited (`at`), right after the
 * words it supports.
 */
export const AiCitation = z
	.object({
		start: z.number().int().nonnegative(),
		end: z.number().int().nonnegative(),
		exact: z.string(),
		at: z.number().int().nonnegative(),
	})
	.meta({ id: "AiCitation" })
export type AiCitation = z.infer<typeof AiCitation>

/** One turn: the reader's question (empty for a plain Explain or Define), or an answer. */
export const AiMessage = z
	.object({
		id: Id,
		role: z.enum(["user", "assistant"]),
		/** Light Markdown: paragraphs, lists, `## ` headings, **bold** and *italics*. */
		text: z.string(),
		/** `failed`: no answer came (try again); `refused`: the model declined to answer. */
		status: z.enum(["done", "failed", "refused"]),
		citations: z.array(AiCitation),
		createdAt: Time,
	})
	.meta({ id: "AiMessage" })
export type AiMessage = z.infer<typeof AiMessage>

const threadShape = {
	id: Id,
	action: z.enum(AI_THREAD_ACTIONS),
	/** The passage asked about, in the article's text; 0 and 0 for a chat. */
	start: z.number().int().nonnegative(),
	end: z.number().int().nonnegative(),
	exact: z.string(),
	/** The version of the article's text the offsets index. */
	versionId: Id,
	highlightId: Id.nullable(),
	/** The passage is no longer in the article: no follow-ups. */
	orphaned: z.boolean(),
	createdAt: Time,
}

/** A question about a passage (or the article's chat), without its turns. */
export const AiThread = z.object(threadShape).meta({ id: "AiThread" })
export type AiThread = z.infer<typeof AiThread>

export const AiThreadWithMessages = z
	.object({ ...threadShape, messages: z.array(AiMessage) })
	.meta({ id: "AiThreadWithMessages" })
export type AiThreadWithMessages = z.infer<typeof AiThreadWithMessages>

/**
 * The article's brief: its gist, then `## Key claims`, `## Keep in mind` and `## Parts`, each
 * cited. The headings are in English whatever the language.
 */
export const AiBrief = z
	.object({ id: Id, versionId: Id, text: z.string(), citations: z.array(AiCitation) })
	.meta({ id: "AiBrief" })
export type AiBrief = z.infer<typeof AiBrief>

/**
 * An answer as it is written: the thread and the question first, with where the account stands
 * against its cap with it counted; then text and citations as they come; then the answer as saved
 * (its `status` says whether it failed).
 */
export const AiAnswerEvent = z
	.discriminatedUnion("type", [
		z.object({
			type: z.literal("start"),
			thread: AiThread,
			question: AiMessage,
			allowance: AiAllowance,
		}),
		z.object({ type: z.literal("text"), text: z.string() }),
		z.object({ type: z.literal("citation"), citation: AiCitation }),
		z.object({ type: z.literal("answer"), message: AiMessage }),
	])
	.meta({ id: "AiAnswerEvent" })
export type AiAnswerEvent = z.infer<typeof AiAnswerEvent>

/**
 * A brief as it is written: where the account stands with it counted, its text and citations as
 * they come, then the brief as kept (null when it failed). One already kept is only its `brief`.
 */
export const AiBriefEvent = z
	.discriminatedUnion("type", [
		z.object({ type: z.literal("allowance"), allowance: AiAllowance }),
		z.object({ type: z.literal("text"), text: z.string() }),
		z.object({ type: z.literal("citation"), citation: AiCitation }),
		z.object({ type: z.literal("brief"), brief: AiBrief.nullable() }),
	])
	.meta({ id: "AiBriefEvent" })
export type AiBriefEvent = z.infer<typeof AiBriefEvent>

/** The language answers are written in; English when left out. */
const Language = z.enum(["en", "es"]).optional()

const Question = z
	.string()
	.max(QUESTION_MAX)
	.refine(withoutNul, NUL_REFUSED)
	.refine((text) => text.trim().length > 0, "The question is empty.")

/** Before any answer: the feature, the server and the cap (and, as everywhere, `rate_limited`). */
const ASK_ERRORS = [
	"forbidden",
	"unavailable",
	"limit_reached",
	"subscription_required",
	"too_large",
] as const

export const getAi = defineEndpoint({
	id: "ai.get",
	method: "GET",
	path: "/ai",
	scope: "read",
	summary:
		"Whether the account can ask the AI about its articles, and how many of this month's questions it has used.",
	response: json(
		z.object({
			/**
			 * The account can ask: AI answers are turned on for it, it has not turned them off in
			 * Settings, and the server has a provider.
			 */
			enabled: z.boolean(),
			/**
			 * The account turned AI answers off in Settings (`enabled` is false): the answers it was
			 * already given can still be read (GET /articles/:id/ai) and deleted, and nothing new asked.
			 */
			turnedOff: z.boolean(),
			/** Null when not enabled. */
			allowance: AiAllowance.nullable(),
			/**
			 * When the account agreed, in one of our apps, that its questions and the article's text go
			 * to the AI provider (PUT /ai/consent); null when it has not, or took it back. The app asks
			 * before the first question while it is null.
			 */
			consentedAt: Time.nullable(),
		}),
	),
	errors: [],
})

export const setAiConsent = defineEndpoint({
	id: "ai.consent",
	method: "PUT",
	path: "/ai/consent",
	scope: "write",
	clients: inAppAi,
	summary:
		"Records whether the account agrees that its questions and the article's text are sent to the AI provider (Anthropic) to answer them, for every device. Agreeing again keeps the first time.",
	body: z.object({ consented: z.boolean() }),
	response: json(z.object({ consentedAt: Time.nullable() })),
	errors: [],
})

export const articleAi = defineEndpoint({
	id: "ai.article",
	method: "GET",
	path: "/articles/:id/ai",
	scope: "read",
	summary:
		"An article's questions and answers, in reading order (its chat among them), and its brief, for every client: reading them costs nothing and never asks the AI. Threads asked of an older version are moved to the current text. Also while the account has AI answers turned off (`turnedOff` in GET /ai).",
	params,
	response: json(z.object({ threads: z.array(AiThreadWithMessages), brief: AiBrief.nullable() })),
	errors: ["not_found", "forbidden", "unavailable"],
})

export const askAi = defineEndpoint({
	id: "ai.ask",
	method: "POST",
	path: "/articles/:id/ai/threads",
	scope: "write",
	clients: inAppAi,
	summary:
		"Explains, defines or answers a question about a passage, found by its place (`start`, `end`) or its text and context. Answers as server-sent events.",
	params,
	body: z
		.object({
			action: z.enum(["explain", "define", "ask"]),
			/** The passage as selected: any length, one word included. */
			exact: z.string().max(QUOTE_MAX),
			prefix: z.string().max(200).optional(),
			suffix: z.string().max(200).optional(),
			start: z.number().int().nonnegative().optional(),
			end: z.number().int().nonnegative().optional(),
			/** Ask's question; Explain and Define may add one. */
			question: z.string().max(QUESTION_MAX).refine(withoutNul, NUL_REFUSED).optional(),
			/** Asked from this highlight. */
			highlightId: Id.optional(),
			language: Language,
		})
		.refine((v) => v.action !== "ask" || !!v.question?.trim(), "Ask needs a question."),
	response: events(AiAnswerEvent),
	errors: [...ASK_ERRORS, "not_found", "not_ready", "no_match", "ambiguous_quote"],
})

export const chatAi = defineEndpoint({
	id: "ai.chat",
	method: "POST",
	path: "/articles/:id/ai/chat",
	scope: "write",
	clients: inAppAi,
	summary:
		"Asks about the whole article, in its one chat: the first question starts it, later ones continue it. Answers as server-sent events.",
	params,
	body: z.object({ question: Question, language: Language }),
	response: events(AiAnswerEvent),
	errors: [...ASK_ERRORS, "not_found", "not_ready", "already_pending"],
})

export const followUpAi = defineEndpoint({
	id: "ai.followUp",
	method: "POST",
	path: "/ai/threads/:id/follow-up",
	scope: "write",
	clients: inAppAi,
	summary: "Asks more in a thread; the answer reads the whole thread. Server-sent events.",
	params,
	body: z.object({ question: Question, language: Language }),
	response: events(AiAnswerEvent),
	/** `already_pending`: the last question is still being answered. */
	errors: [...ASK_ERRORS, "not_found", "no_match", "already_pending"],
})

export const retryAi = defineEndpoint({
	id: "ai.retry",
	method: "POST",
	path: "/ai/threads/:id/retry",
	scope: "write",
	clients: inAppAi,
	summary:
		"Answers the thread's last question again, in place of its answer (failed or not). Server-sent events.",
	params,
	body: z.object({ language: Language }).default({}),
	response: events(AiAnswerEvent),
	errors: [...ASK_ERRORS, "not_found", "no_match", "already_pending"],
})

export const deleteAiThread = defineEndpoint({
	id: "ai.delete",
	method: "DELETE",
	path: "/ai/threads/:id",
	scope: "write",
	clients: inAppAi,
	summary: "Deletes a thread and its answers. POST /ai/threads/{id}/restore undoes it.",
	params,
	response: empty(),
	errors: ["not_found"],
})

export const restoreAiThread = defineEndpoint({
	id: "ai.restore",
	method: "POST",
	path: "/ai/threads/:id/restore",
	scope: "write",
	clients: inAppAi,
	summary:
		"Undoes DELETE /ai/threads/{id} while its article is in the library; a chat, only while the article has no newer one.",
	params,
	response: json(z.object({ thread: AiThreadWithMessages })),
	errors: ["not_found"],
})

export const briefAi = defineEndpoint({
	id: "ai.brief",
	method: "POST",
	path: "/articles/:id/ai/brief",
	scope: "write",
	clients: inAppAi,
	summary:
		"The article's brief: the one kept for its text, at no cost, or a new one, written as it streams and counted like a question. Server-sent events.",
	params,
	body: z.object({ language: Language }).default({}),
	response: events(AiBriefEvent),
	/** `already_pending`: one is being written for this text already. */
	errors: [...ASK_ERRORS, "not_found", "not_ready", "already_pending"],
})
