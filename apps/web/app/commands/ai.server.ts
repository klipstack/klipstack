import { type AiLanguage, type AnswerEvent, AI_ACTIONS, AiError, type Turn } from "@klipstack/ai"
import { resolveSelector } from "@klipstack/anchor"
import { Id, NUL_REFUSED, QUOTE_MAX, withoutNul } from "@klipstack/api-contract"
import { type AiBrief, type AiMessage, type AiThread, type AiThreadAction, db } from "@klipstack/db"
import { safeFields } from "@klipstack/log"
import { z } from "zod"
import { AI_RATE_LIMIT, ai } from "~/lib/ai.server"
import { AppError, notFound, parseInput, rateLimited } from "~/lib/app-error"
import { hasFeature } from "~/lib/features.server"
import { countMonthly } from "~/lib/limits.server"
import { rateLimit } from "~/lib/rate-limit.server"
import {
	deleteMessage,
	deleteThread as removeThread,
	getBrief,
	getChat,
	getThread,
	insertBrief,
	insertMessage,
	insertThread,
	lockChat,
	restoreThread as bringBack,
	type ThreadWithMessages,
} from "~/services/ai-threads.server"
import { getDocument } from "~/services/documents.server"
import { currentText, getHighlight } from "~/services/highlights.server"
import { NO_ARTICLE } from "./articles.server"

/**
 * Questions about a passage, answered by the AI module. Each question (a first one, a follow-up, a
 * retry) counts against the monthly `ai` cap when it is sent. The answer streams; it is written
 * when it ends, failed ones included, so the card can offer Retry.
 */

const NO_THREAD = "No thread with that id."

// The module's actions and the ones the table stores are one list, kept in two packages that
// don't depend on each other: this fails to compile when they drift.
const sameActions: [AiThreadAction, (typeof AI_ACTIONS)[number]] extends [
	(typeof AI_ACTIONS)[number],
	AiThreadAction,
]
	? true
	: never = true
void sameActions
/** Characters in a question. */
export const QUESTION_MAX = 2000
/** A question left unanswered this long is taken as lost, and can be asked again. */
const PENDING_MS = 90_000

const Question = z
	.string()
	.max(QUESTION_MAX)
	.refine(withoutNul, NUL_REFUSED)
	.refine((text) => text.trim().length > 0, "The question is empty.")

const NewThread = z
	.object({
		// A chat has no passage: `askArticle`.
		action: z.enum(AI_ACTIONS).exclude(["chat"]),
		/** The passage as the reader selected it: any length, one word included. */
		exact: z
			.string()
			.max(QUOTE_MAX)
			.refine((text) => text.trim().length > 0, "The passage is empty."),
		prefix: z.string().max(200).optional(),
		suffix: z.string().max(200).optional(),
		start: z.number().int().nonnegative().optional(),
		end: z.number().int().nonnegative().optional(),
		/** Ask's question; Explain and Define may add one. */
		question: z.string().max(QUESTION_MAX).refine(withoutNul, NUL_REFUSED).optional(),
		/** Asked from a highlight's toolbar. */
		highlightId: Id.optional(),
	})
	.refine((v) => v.action !== "ask" || !!v.question?.trim(), "Ask needs a question.")

export type NewThreadInput = z.input<typeof NewThread>

export interface AskOptions {
	/** The language to answer in: the reader's interface language. */
	language: AiLanguage
	/** Cancels the answer, as when the reader goes away. */
	signal?: AbortSignal
}

/** A question on its way: its thread and turn now, then the answer as it is written. */
export interface Asked {
	thread: AiThread
	question: AiMessage
	events: AsyncIterable<AnswerEvent>
	/** The answer as saved, `failed` included. Settles once `events` is read to its end. */
	answer: Promise<AiMessage>
}

/** The checks every question goes through, in order: the feature, the server, the pace. */
async function mayAsk(userId: string) {
	if (!(await hasFeature(userId, "ai")))
		throw new AppError("forbidden", "AI answers are not turned on for this account.")
	if (!ai.available) throw new AppError("unavailable", "AI answers are not set up on this server.")
	const limited = rateLimit(`ai:${userId}`, AI_RATE_LIMIT.limit, AI_RATE_LIMIT.windowMs)
	if (!limited.ok) throw rateLimited(limited.retryAfterSeconds, "questions")
	return limited
}

/** Explains, defines or answers a question about a passage of the user's article. */
export async function askAboutPassage(
	userId: string,
	articleId: string,
	input: NewThreadInput,
	options: AskOptions,
): Promise<Asked> {
	const { action, question, highlightId, ...passage } = parseInput(NewThread, input)
	const documentId = parseInput(Id, articleId)
	const doc = await getDocument(userId, documentId)
	if (!doc) throw notFound(NO_ARTICLE)
	const limited = await mayAsk(userId)
	try {
		const version = await currentText(documentId, doc.currentVersionId)
		if (!version || doc.status !== "ready")
			throw new AppError("not_ready", "The article text is not available yet. Try again later.")
		mayRead(version.text)
		const resolved = resolveSelector(version.text, passage)
		if (!resolved) throw new AppError("no_match", "That passage is not in the article.")
		if ("ambiguous" in resolved)
			throw new AppError(
				"ambiguous_quote",
				`That passage appears ${resolved.candidates.length} times. Pass its start and end.`,
			)
		if (highlightId) {
			const highlight = await getHighlight(userId, highlightId)
			if (highlight?.documentId !== documentId) throw notFound("No highlight with that id.")
		}
		const { thread, turn } = await db.transaction(async (tx) => {
			await countMonthly(tx, userId, "ai")
			const thread = await insertThread(tx, {
				userId,
				documentId,
				versionId: version.id,
				start: resolved.start,
				end: resolved.end,
				text: version.text,
				action,
				highlightId,
			})
			const turn = await insertMessage(tx, {
				threadId: thread.id,
				role: "user",
				text: question?.trim() ?? "",
			})
			return { thread, turn }
		})
		return answerThread({ ...thread, messages: [turn] }, turn, { doc, version }, options)
	} catch (error) {
		limited.refund()
		throw error
	}
}

/**
 * A question about the whole article, in its chat: the first one starts the article's one chat,
 * later ones continue it.
 */
export async function askArticle(
	userId: string,
	articleId: string,
	text: string,
	options: AskOptions,
): Promise<Asked> {
	const question = parseInput(Question, text).trim()
	const documentId = parseInput(Id, articleId)
	const chat = await getChat(userId, documentId)
	if (chat) return followUp(userId, chat.id, question, options)
	const doc = await getDocument(userId, documentId)
	if (!doc) throw notFound(NO_ARTICLE)
	const version = await currentText(documentId, doc.currentVersionId)
	if (!version || doc.status !== "ready")
		throw new AppError("not_ready", "The article text is not available yet. Try again later.")
	mayRead(version.text)
	const limited = await mayAsk(userId)
	try {
		const started = await db.transaction(async (tx) => {
			// Another tab may be starting it right now: the second waits, then continues the first's.
			await lockChat(tx, documentId)
			if (await getChat(userId, documentId, tx)) return null
			await countMonthly(tx, userId, "ai")
			const thread = await insertThread(tx, {
				userId,
				documentId,
				versionId: version.id,
				start: 0,
				end: 0,
				text: version.text,
				action: "chat",
			})
			const turn = await insertMessage(tx, { threadId: thread.id, role: "user", text: question })
			return { thread, turn }
		})
		if (!started) {
			limited.refund()
			return askArticle(userId, articleId, text, options)
		}
		const { thread, turn } = started
		return answerThread({ ...thread, messages: [turn] }, turn, { doc, version }, options)
	} catch (error) {
		limited.refund()
		throw error
	}
}

/** Asks more in a thread. The answer reads the whole thread. */
export async function followUp(
	userId: string,
	threadId: string,
	text: string,
	options: AskOptions,
): Promise<Asked> {
	const question = parseInput(Question, text).trim()
	const thread = await answerable(userId, threadId)
	const last = thread.messages.at(-1)
	if (last?.role === "user") throw pending(last)
	const article = await articleOf(userId, thread)
	const limited = await mayAsk(userId)
	try {
		const turn = await db.transaction(async (tx) => {
			await countMonthly(tx, userId, "ai")
			return insertMessage(tx, { threadId: thread.id, role: "user", text: question })
		})
		return answerThread({ ...thread, messages: [...thread.messages, turn] }, turn, article, options)
	} catch (error) {
		limited.refund()
		throw error
	}
}

/** Answers the thread's last question again, in place of its answer (failed or not). */
export async function retryAnswer(
	userId: string,
	threadId: string,
	options: AskOptions,
): Promise<Asked> {
	const thread = await answerable(userId, threadId)
	let messages = thread.messages
	const last = messages.at(-1)
	if (last?.role === "user" && Date.now() - last.createdAt.getTime() < PENDING_MS)
		throw pending(last)
	if (last?.role === "assistant") messages = messages.slice(0, -1)
	const question = messages.at(-1)
	if (!question) throw new Error("a thread without a question")
	const article = await articleOf(userId, thread)
	const limited = await mayAsk(userId)
	try {
		// Counted, and the old answer gone, together: a refusal keeps the answer.
		await db.transaction(async (tx) => {
			await countMonthly(tx, userId, "ai")
			if (last?.role === "assistant") await deleteMessage(last.id, tx)
		})
		return answerThread({ ...thread, messages }, question, article, options)
	} catch (error) {
		limited.refund()
		throw error
	}
}

/** Deletes a thread and its answers; `restoreThread` brings it back. */
export async function deleteThread(userId: string, id: string): Promise<void> {
	if (!(await removeThread(userId, parseInput(Id, id)))) throw notFound(NO_THREAD)
}

/** Undo of `deleteThread`, while its article is in the library. */
export async function restoreThread(userId: string, id: string): Promise<void> {
	if (!(await bringBack(userId, parseInput(Id, id)))) throw notFound(NO_THREAD)
}

async function answerable(userId: string, id: string): Promise<ThreadWithMessages> {
	const thread = await getThread(userId, parseInput(Id, id))
	if (!thread) throw notFound(NO_THREAD)
	if (thread.orphaned) throw new AppError("no_match", "The passage is no longer in the article.")
	return thread
}

/** A brief on its way: what is written as it comes, then the brief as kept (null if it failed). */
export interface Briefing {
	events: AsyncIterable<AnswerEvent>
	brief: Promise<AiBrief | null>
}

/**
 * The article's brief: the one kept for its version, at no cost, or a new one, written as it
 * streams and counted against the cap like a question. A failed one is not kept.
 */
export async function briefArticle(
	userId: string,
	articleId: string,
	{ language }: AskOptions,
): Promise<AiBrief | Briefing> {
	const documentId = parseInput(Id, articleId)
	const doc = await getDocument(userId, documentId)
	if (!doc) throw notFound(NO_ARTICLE)
	const version = await currentText(documentId, doc.currentVersionId)
	if (!version || doc.status !== "ready")
		throw new AppError("not_ready", "The article text is not available yet. Try again later.")
	const kept = await getBrief(userId, version.id)
	if (kept) return kept
	// One being written already (another tab): a second would be charged for the same brief.
	if (writingBriefs.has(version.id))
		throw new AppError("already_pending", "The brief is still being written.")
	mayRead(version.text)
	const limited = await mayAsk(userId)
	try {
		await db.transaction((tx) => countMonthly(tx, userId, "ai"))
	} catch (error) {
		limited.refund()
		throw error
	}
	writingBriefs.add(version.id)
	// No `signal`: a reader who leaves doesn't stop it. It is paid for, and kept for the next visit.
	const brief = ai.brief({
		article: {
			title: doc.title ?? "",
			author: doc.author,
			siteName: doc.siteName,
			text: version.text,
		},
		language,
	})
	const saved = brief.done.then(
		(result) => {
			log({ documentId, model: result.model, status: result.status, ...result.usage }, "brief")
			if (result.status !== "done" || !result.text.trim()) return null
			return insertBrief({
				userId,
				documentId,
				versionId: version.id,
				text: result.text,
				citations: result.citations,
				model: result.model,
				inputTokens: result.usage.inputTokens,
				outputTokens: result.usage.outputTokens,
				cacheReadTokens: result.usage.cacheReadTokens,
			})
		},
		(error: unknown) => {
			const reason = error instanceof AiError ? error.reason : "provider"
			log({ documentId, status: "failed", reason, error }, "brief")
			return null
		},
	)
	void saved.finally(() => writingBriefs.delete(version.id))
	return { events: brief.events, brief: saved }
}

/** Versions whose brief is being written, in this server process (one web process serves the app). */
const writingBriefs = new Set<string>()

/** Characters of article text sent with a question: about 100,000 tokens, a long book chapter. */
export const AI_TEXT_MAX = 400_000

/** Refuses an article too long to send, before it costs a question. */
function mayRead(text: string) {
	if (text.length > AI_TEXT_MAX)
		throw new AppError("too_large", "The article is too long to ask about.", {
			details: { length: text.length, max: AI_TEXT_MAX },
		})
}

type Article = {
	doc: NonNullable<Awaited<ReturnType<typeof getDocument>>>
	version: NonNullable<Awaited<ReturnType<typeof currentText>>>
}

/** The thread's article and the text its answers read, checked before a question is counted. */
async function articleOf(userId: string, thread: AiThread): Promise<Article> {
	const doc = await getDocument(userId, thread.documentId)
	const version = doc && (await currentText(thread.documentId, thread.versionId))
	if (!doc || !version) throw notFound(NO_ARTICLE)
	mayRead(version.text)
	return { doc, version }
}

const pending = (question: AiMessage) =>
	new AppError("already_pending", "The last question is still being answered.", {
		details: { messageId: question.id },
	})

/**
 * Asks the AI module for the thread's answer, and writes it when it ends: its text, citations and
 * cost, or `failed` when the provider broke off or the reader went away.
 */
function answerThread(
	thread: ThreadWithMessages,
	question: AiMessage,
	{ doc, version }: Article,
	{ language, signal }: AskOptions,
): Asked {
	const turns: Turn[] = thread.messages
		.filter((m) => m.role === "user" || m.status !== "failed")
		.map((m) => ({ role: m.role, text: m.text }))
	const answer = ai.answer({
		tier: "quick",
		article: {
			title: doc.title ?? "",
			author: doc.author,
			siteName: doc.siteName,
			text: version.text,
		},
		thread: {
			action: thread.action,
			passage: { exact: thread.exact, start: thread.startOffset, end: thread.endOffset },
			turns,
		},
		language,
		signal,
	})
	const saved = answer.done.then(
		async (result) => {
			log({ threadId: thread.id, model: result.model, status: result.status, ...result.usage })
			return insertMessage(db, {
				threadId: thread.id,
				role: "assistant",
				text: result.text,
				status: result.status,
				citations: result.citations,
				model: result.model,
				inputTokens: result.usage.inputTokens,
				outputTokens: result.usage.outputTokens,
				cacheReadTokens: result.usage.cacheReadTokens,
			})
		},
		async (error: unknown) => {
			const reason = error instanceof AiError ? error.reason : "provider"
			log({ threadId: thread.id, status: "failed", reason, error })
			return insertMessage(db, {
				threadId: thread.id,
				role: "assistant",
				text: "",
				status: "failed",
			})
		},
	)
	return { thread, question, events: answer.events, answer: saved }
}

/** Ids, the model and token counts: never the article or the question. */
function log(fields: Record<string, unknown>, what: "answer" | "brief" = "answer") {
	console.info(`[ai] ${what} ${JSON.stringify(safeFields(fields))}`)
}
