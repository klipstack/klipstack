import type { AiBriefEvent, AiBriefView, AiStreamEvent } from "./ai-threads"
import { refusal } from "./web-result"

/** Why a question was not answered: a refusal's code (`limit_reached`, …), or `network`. */
export interface AiFailure {
	code: string
	details?: Record<string, unknown>
}

export type AiStreamResult = { ok: true } | { ok: false; error: AiFailure }

const NETWORK: AiStreamResult = { ok: false, error: { code: "network" } }

/**
 * Sends a question (`/documents/:id/ai`) and hands each event of the answer to `onEvent` as it
 * arrives. Settles when the answer is complete, with the refusal when there was one before it began.
 */
export async function streamAnswer(
	documentId: string,
	body: Record<string, unknown>,
	onEvent: (event: AiStreamEvent) => void,
	signal?: AbortSignal,
): Promise<AiStreamResult> {
	let res: Response
	try {
		res = await fetch(`/documents/${documentId}/ai`, {
			method: "POST",
			headers: { "content-type": "application/json", accept: "text/event-stream" },
			body: JSON.stringify(body),
			signal,
		})
	} catch {
		return NETWORK
	}
	if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
		const error = refusal(await res.json().catch(() => null))
		return error ? { ok: false, error } : NETWORK
	}
	return (await readEvents(res, onEvent, "answer")) ? { ok: true } : NETWORK
}

/**
 * Hands each `data:` event of a stream to `onEvent`. True once the `last` event came: a stream that
 * breaks off before it is not complete.
 */
async function readEvents<E extends { type: string }>(
	res: Response,
	onEvent: (event: E) => void,
	last: E["type"],
): Promise<boolean> {
	if (!res.body) return false
	const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
	let buffer = ""
	let finished = false
	try {
		for (;;) {
			const { done, value } = await reader.read()
			if (done) break
			buffer += value
			let end = buffer.indexOf("\n\n")
			while (end >= 0) {
				const chunk = buffer.slice(0, end)
				buffer = buffer.slice(end + 2)
				if (chunk.startsWith("data: ")) {
					const event = JSON.parse(chunk.slice(6)) as E
					if (event.type === last) finished = true
					onEvent(event)
				}
				end = buffer.indexOf("\n\n")
			}
		}
	} catch {
		// Broke off: what was saved comes with the next load.
	}
	return finished
}

/**
 * Asks for the article's brief: the one kept for its version comes at once (`onEvent` sees only
 * `brief`); a new one streams its text and citations first.
 */
export async function requestBrief(
	documentId: string,
	onEvent: (event: AiBriefEvent) => void,
): Promise<AiStreamResult> {
	let res: Response
	try {
		res = await fetch(`/documents/${documentId}/ai`, {
			method: "POST",
			headers: { "content-type": "application/json", accept: "text/event-stream" },
			body: JSON.stringify({ intent: "brief" }),
		})
	} catch {
		return NETWORK
	}
	if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
		const body = (await res.json().catch(() => null)) as {
			ok?: boolean
			brief?: AiBriefView
		} | null
		if (body?.ok && body.brief) {
			onEvent({ type: "brief", brief: body.brief })
			return { ok: true }
		}
		const error = refusal(body)
		return error ? { ok: false, error } : NETWORK
	}
	return (await readEvents(res, onEvent, "brief")) ? { ok: true } : NETWORK
}

/** A plain change to a thread: delete. */
export async function changeThread(
	documentId: string,
	body: Record<string, unknown>,
): Promise<AiStreamResult> {
	try {
		const res = await fetch(`/documents/${documentId}/ai`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		})
		const data = await res.json().catch(() => null)
		const error = refusal(data)
		if (error) return { ok: false, error }
		return res.ok ? { ok: true } : NETWORK
	} catch {
		return NETWORK
	}
}
