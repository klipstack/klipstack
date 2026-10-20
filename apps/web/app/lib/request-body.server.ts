import { AppError } from "./app-error"
import { BodyRefusal, readBody } from "./body-reader.server"
import { takeUploadSlot } from "./upload-slots.server"

const SMALL_BODY = 64 * 1024
const FORM_BODY = 1024 * 1024
export const CAPTURE_BODY = 12 * 1024 * 1024
const FORM_TIMEOUTS = { idleMs: 10_000, totalMs: 30_000 }
let active = 0

const refusals = {
	too_large: [413, "Request body is too large."],
	too_slow: [408, "Upload timed out."],
	unreadable: [400, "The body could not be read."],
	large_refused: [429, "Too many uploads."],
} as const

/** Read before parsing, bounding bytes, time, and concurrent memory use (also for chunked bodies). */
export async function boundedRequest(
	request: Request,
	limit = SMALL_BODY,
	owner = "anonymous",
	timeouts = FORM_TIMEOUTS,
): Promise<Request> {
	if (!request.body) return request
	const reject = (status: number, text: string) =>
		new Response(text, {
			status,
			headers: {
				"Cache-Control": "no-store",
				Connection: "close",
				...(status === 429 ? { "Retry-After": "2" } : {}),
			},
		})
	if (active >= 64) throw reject(429, "Too many uploads.")
	const release = limit > FORM_BODY ? takeUploadSlot(owner) : () => {}
	if (!release) throw reject(429, "Too many uploads.")
	active++
	try {
		// Cancelling the Express adapter's stream destroys the socket before it can send
		// 413/408: `readBody` leaves it paused, and Connection: close ends it after the response.
		const body = await readBody(request, limit, { timeouts, overflow: FORM_BODY })
		return new Request(request.url, {
			method: request.method,
			headers: request.headers,
			body: body ?? new Uint8Array(0),
			signal: request.signal,
			redirect: request.redirect,
		})
	} catch (error) {
		if (error instanceof BodyRefusal) {
			const [status, text] = refusals[error.reason]
			throw reject(status, text)
		}
		throw error
	} finally {
		active--
		release()
	}
}

export async function readForm(request: Request) {
	const path = new URL(request.url).pathname.replace(/\.data$/, "")
	const small = [
		"/login",
		"/signup",
		"/request-invite",
		"/magic-link",
		"/forgot-password",
		"/reset-password",
	]
	const limit = small.includes(path) ? SMALL_BODY : FORM_BODY
	return (await boundedRequest(request, limit)).formData()
}

export async function readJson(request: Request, limit = FORM_BODY, owner?: string) {
	return (await boundedRequest(request, limit, owner)).json()
}

/** A JSON body within the auth forms' limit; malformed JSON is a refusal (`invalid_request`). */
export async function readSmallJson(request: Request): Promise<unknown> {
	const bounded = await boundedRequest(request)
	try {
		return await bounded.json()
	} catch {
		throw new AppError("invalid_request", "The body is not valid JSON.")
	}
}

/**
 * A JSON body, or a form's fields (a page without JavaScript posts a form), as an object. Malformed
 * JSON is a refusal (`invalid_request`); a body past its limit throws its own answer.
 */
export async function readFields(request: Request): Promise<Record<string, unknown>> {
	if (!(request.headers.get("content-type") ?? "").includes("application/json"))
		return Object.fromEntries((await readForm(request)).entries())
	let body: unknown
	try {
		body = await readJson(request)
	} catch (error) {
		if (error instanceof Response) throw error
		throw new AppError("invalid_request", "The body is not valid JSON.")
	}
	return body && typeof body === "object" ? (body as Record<string, unknown>) : {}
}
