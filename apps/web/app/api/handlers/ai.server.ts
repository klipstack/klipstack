import type {
	articleAi,
	askAi,
	briefAi,
	chatAi,
	deleteAiThread,
	followUpAi,
	getAi,
	restoreAiThread,
	retryAi,
	setAiConsent as setAiConsentEndpoint,
} from "@klipstack/api-contract"
import {
	type AskOptions,
	askAboutPassage,
	askArticle,
	briefArticle,
	deleteThread,
	followUp,
	mayUseAi,
	restoreThread,
	retryAnswer,
	setAiConsent,
} from "~/commands/ai.server"
import { NO_ARTICLE } from "~/commands/articles.server"
import { answerEvents, briefEvents } from "~/lib/ai-events.server"
import { briefView, messageView, threadView } from "~/lib/ai-threads"
import { ai } from "~/lib/ai.server"
import { hasFeature } from "~/lib/features.server"
import { aiAllowance } from "~/lib/limits.server"
import { aiConsentedAt } from "~/services/account.server"
import { getBrief, getThread, listDocumentThreads } from "~/services/ai-threads.server"
import { getDocument } from "~/services/documents.server"
import { notFound } from "../errors.server"
import type { Handler } from "../handler.server"

/**
 * The reader's AI over the API, for the iPhone app: the same commands as the web reader's
 * (`routes/documents.ai.ts`), so the monthly cap and the rate limit count every client's questions
 * together. Answers stream as server-sent events.
 *
 * Unlike the web reader, a client that goes away does not cut its answer off: the question is
 * counted already, and a phone loses its connection more often than a tab is closed. The answer
 * is saved when it ends, and shows the next time the article's threads are read.
 */
const options = (language: "en" | "es" | undefined): AskOptions => ({ language: language ?? "en" })

const enabled = async (userId: string) => ai.available && (await hasFeature(userId, "ai"))

export const status: Handler<typeof getAi> = async ({ userId }) => {
	const consentedAt = await aiConsentedAt(userId)
	if (!(await enabled(userId))) return { enabled: false, allowance: null, consentedAt }
	return { enabled: true, allowance: await aiAllowance(userId), consentedAt }
}

export const consent: Handler<typeof setAiConsentEndpoint> = async ({ userId, body }) =>
	setAiConsent(userId, body)

export const article: Handler<typeof articleAi> = async ({ userId, params }) => {
	await mayUseAi(userId)
	const doc = await getDocument(userId, params.id)
	if (!doc) throw notFound(NO_ARTICLE)
	const versionId = doc.currentVersionId
	if (!versionId) return { threads: [], brief: null }
	const [threads, brief] = await Promise.all([
		listDocumentThreads(userId, doc.id, versionId),
		getBrief(userId, versionId),
	])
	return {
		threads: threads.map((thread) => ({
			...threadView(thread),
			messages: thread.messages.map(messageView),
		})),
		brief: brief && briefView(brief),
	}
}

export const ask: Handler<typeof askAi> = async ({ userId, params, body }) => {
	const { language, ...input } = body
	return answerEvents(await askAboutPassage(userId, params.id, input, options(language)))
}

export const chat: Handler<typeof chatAi> = async ({ userId, params, body }) =>
	answerEvents(await askArticle(userId, params.id, body.question, options(body.language)))

export const more: Handler<typeof followUpAi> = async ({ userId, params, body }) =>
	answerEvents(await followUp(userId, params.id, body.question, options(body.language)))

export const again: Handler<typeof retryAi> = async ({ userId, params, body }) =>
	answerEvents(await retryAnswer(userId, params.id, options(body.language)))

export const remove: Handler<typeof deleteAiThread> = async ({ userId, params }) => {
	await deleteThread(userId, params.id)
}

/** Undo of a delete; answers the thread, so the app can show it again. */
export const restore: Handler<typeof restoreAiThread> = async ({ userId, params }) => {
	await restoreThread(userId, params.id)
	const thread = await getThread(userId, params.id)
	if (!thread) throw notFound("No thread with that id.")
	return { thread: { ...threadView(thread), messages: thread.messages.map(messageView) } }
}

export const brief: Handler<typeof briefAi> = async ({ userId, params, body }) =>
	briefEvents(await briefArticle(userId, params.id, options(body.language)))
