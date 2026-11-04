import { subscribeDocumentEvents } from "~/lib/events.server"
import { requireUser } from "~/lib/session.server"
import type { Route } from "./+types/api.events"

const PING_MS = 25_000

/**
 * GET /api/events?since=<ms> — server-sent events for the signed-in user: `event: document` with
 * `{ documentId, kind }` whenever one of their documents changes, and `event: feed` when new items
 * arrive in their feeds. `since` is when the page read what it shows (the root loader's
 * `liveSince`); a `document` event without a payload says something changed since, or may have,
 * and the page loads again. Pings keep proxies from closing the idle connection; the browser
 * reconnects on its own.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	// Without a time, anything may have been missed.
	const since = Number(new URL(request.url).searchParams.get("since")) || 0
	const encoder = new TextEncoder()
	let cleanup = () => {}
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (chunk: string) => {
				try {
					controller.enqueue(encoder.encode(chunk))
				} catch {
					cleanup()
				}
			}
			send("retry: 3000\n\n")
			const unsubscribe = subscribeDocumentEvents(user.id, since, (event) => {
				if (!event) send("event: document\ndata: {}\n\n")
				else if (event.kind === "feed") send("event: feed\ndata: {}\n\n")
				else
					send(
						`event: document\ndata: ${JSON.stringify({ documentId: event.documentId, kind: event.kind })}\n\n`,
					)
			})
			const ping = setInterval(() => send(": ping\n\n"), PING_MS)
			cleanup = () => {
				clearInterval(ping)
				unsubscribe()
				try {
					controller.close()
				} catch {
					// already closed
				}
			}
			request.signal.addEventListener("abort", cleanup, { once: true })
		},
		cancel() {
			cleanup()
		},
	})
	return new Response(stream, {
		headers: {
			"content-type": "text/event-stream; charset=utf-8",
			// no-transform keeps compression middleware and proxies from buffering the stream
			"cache-control": "no-cache, no-transform",
			connection: "keep-alive",
			"x-accel-buffering": "no",
		},
	})
}
