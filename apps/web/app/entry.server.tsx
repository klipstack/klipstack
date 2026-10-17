import { PassThrough } from "node:stream"
import { pool } from "@klipstack/db"
import { logError, loggedPath } from "@klipstack/log"
import { stopBoss } from "@klipstack/queue"
import { createReadableStreamFromReadable } from "@react-router/node"
import { isbot } from "isbot"
import type { RenderToPipeableStreamOptions } from "react-dom/server"
import { renderToPipeableStream } from "react-dom/server"
import { I18nextProvider } from "react-i18next"
import type { EntryContext, HandleErrorFunction, RouterContextProvider } from "react-router"
import { isRouteErrorResponse, ServerRouter } from "react-router"
import { createNonce, documentPolicy } from "~/lib/csp.server"
import { stopDocumentEvents } from "~/lib/events.server"
import { getInstanceOrFallback } from "~/lib/i18n.server"
import { getSession } from "~/lib/session.server"

export const streamTimeout = 5_000

export default function handleRequest(
	request: Request,
	responseStatusCode: number,
	responseHeaders: Headers,
	routerContext: EntryContext,
	loadContext: RouterContextProvider,
) {
	return new Promise((resolve, reject) => {
		let shellRendered = false
		const userAgent = request.headers.get("user-agent")
		const readyOption: keyof RenderToPipeableStreamOptions =
			(userAgent && isbot(userAgent)) || routerContext.isSpaMode ? "onAllReady" : "onShellReady"

		const i18n = getInstanceOrFallback(loadContext)
		// Replaces a route's own policy: this one includes it (frame-ancestors 'none').
		const nonce = createNonce()
		const signedIn = Boolean(getSession(loadContext))
		responseHeaders.set("Content-Security-Policy", documentPolicy(nonce, { signedIn }))

		const { pipe, abort } = renderToPipeableStream(
			<I18nextProvider i18n={i18n}>
				<ServerRouter context={routerContext} url={request.url} nonce={nonce} />
			</I18nextProvider>,
			{
				nonce,
				[readyOption]() {
					shellRendered = true
					const body = new PassThrough()
					const stream = createReadableStreamFromReadable(body)
					responseHeaders.set("Content-Type", "text/html")
					resolve(new Response(stream, { headers: responseHeaders, status: responseStatusCode }))
					pipe(body)
				},
				onShellError(error: unknown) {
					reject(error)
				},
				onError(error: unknown) {
					responseStatusCode = 500
					if (shellRendered)
						logError(`[render] ${loggedPath(new URL(request.url).pathname)}`, error)
				},
			},
		)
		setTimeout(abort, streamTimeout + 1_000)
	})
}

/**
 * Errors from loaders and actions. React Router's default prints the whole error, and a failed
 * query's message lists its parameters (notes, captured pages): log it without the message.
 */
export const handleError: HandleErrorFunction = (error, { request }) => {
	if (request.signal.aborted) return
	const route = `[route] ${request.method} ${loggedPath(new URL(request.url).pathname)}`
	// Error responses (no such route, wrong method): the request log already shows them; only the
	// server's own failures are worth a line here.
	if (isRouteErrorResponse(error)) {
		if (error.status >= 500) console.error(`${route} → ${error.status}`)
		return
	}
	logError(route, error)
}

/**
 * Closes what keeps Node running (the database pool, the event listener, the queue client).
 * server.js calls it on SIGTERM once the HTTP server has stopped.
 */
export async function shutdown() {
	stopDocumentEvents()
	await Promise.allSettled([stopBoss(), pool.end()])
}
