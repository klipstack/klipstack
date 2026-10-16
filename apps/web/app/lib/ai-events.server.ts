import type { AiBrief } from "@klipstack/db"
import { logError } from "@klipstack/log"
import type { Asked, Briefing } from "~/commands/ai.server"
import {
	type AiBriefEvent,
	type AiStreamEvent,
	briefView,
	messageView,
	threadView,
} from "./ai-threads"

/**
 * What the reader's stream and the API's (`ai.ask`, `ai.chat`, …) send of an answer: the thread,
 * the question and where the account stands; the text and citations as they are written; then the
 * answer as saved (its `status` says whether it failed).
 */
export async function* answerEvents(asked: Asked): AsyncGenerator<AiStreamEvent> {
	yield {
		type: "start",
		thread: threadView(asked.thread),
		question: messageView(asked.question),
		allowance: asked.allowance,
	}
	try {
		for await (const event of asked.events) yield event
	} catch {
		// A failed answer is saved as such: `answer` below says so.
	}
	try {
		yield { type: "answer", message: messageView(await asked.answer) }
	} catch (error) {
		logError("[ai] saving an answer failed", error)
	}
}

/**
 * A brief as it is written, then as kept (null when it failed). One kept already is only that:
 * it cost nothing.
 */
export async function* briefEvents(briefing: AiBrief | Briefing): AsyncGenerator<AiBriefEvent> {
	if (!("events" in briefing)) {
		yield { type: "brief", brief: briefView(briefing) }
		return
	}
	yield { type: "allowance", allowance: briefing.allowance }
	try {
		for await (const event of briefing.events) yield event
	} catch {
		// Failed: `brief` below says so.
	}
	try {
		const brief = await briefing.brief
		yield { type: "brief", brief: brief && briefView(brief) }
	} catch (error) {
		logError("[ai] saving a brief failed", error)
		yield { type: "brief", brief: null }
	}
}

/** `no-transform` keeps compression off the stream; `x-accel-buffering` keeps proxies from holding it. */
export const EVENT_STREAM_HEADERS = {
	"content-type": "text/event-stream; charset=utf-8",
	"cache-control": "no-cache, no-transform",
	"x-accel-buffering": "no",
}

/**
 * Server-sent events, one JSON value per `data:` line, so the proxy and the compression middleware
 * pass each on as it comes. The events are read to their end even when the client goes away: an
 * answer is saved when its stream ends.
 */
export function eventStream(
	events: AsyncIterable<unknown>,
	{ status = 200 }: { status?: number } = {},
): Response {
	const encoder = new TextEncoder()
	const body = new ReadableStream<Uint8Array>({
		async start(controller) {
			try {
				for await (const event of events) {
					try {
						controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
					} catch {
						// The client went away; what it asked for is still saved.
					}
				}
			} catch (error) {
				logError("[ai] an event stream broke off", error)
			}
			try {
				controller.close()
			} catch {}
		},
	})
	return new Response(body, { status, headers: EVENT_STREAM_HEADERS })
}
