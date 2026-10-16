import {
	bodyLimitOf,
	type Endpoint,
	type ResponseKind,
	UNAUTHENTICATED_BODY_LIMIT,
} from "@klipstack/api-contract"
import { LIBRARY_WRITE_SCOPE } from "@klipstack/api-contract/auth"
import { logError } from "@klipstack/log"
import { z } from "zod"
import { eventStream } from "~/lib/ai-events.server"
import { AppError } from "~/lib/app-error"
import { type BodyTimeouts, BodyRefusal, discardBody, readBody } from "~/lib/body-reader.server"
import { LARGE_UPLOADS, takeUploadSlot } from "~/lib/upload-slots.server"
import type { ApiPrincipal } from "./auth.server"
import { ApiError, errorResponse, insufficientScope, notFound, rateLimited } from "./errors.server"
import { type HandlerTable, Reply } from "./handler.server"

/**
 * One splat route, one table: every endpoint of the contract is dispatched here. The router does
 * the parts every endpoint shares (matching, auth and scopes, the rate limit, body limits,
 * validation, error bodies) so handlers only turn parsed input into results.
 */

export const API_PREFIX = "/api/v1"

/** A limit's answer; `refund` gives the hit back when the request is refused before any work. */
export type RateResult =
	| { ok: true; refund?: () => void }
	| { ok: false; retryAfterSeconds: number }
type Auth = { principal: null } | { principal: ApiPrincipal; userId: string; access: string }

/** Bodies over this take a large-upload slot while the request runs. */
export const LARGE_BODY = 256 * 1024

export interface RouterOptions<T extends Record<string, Endpoint>> {
	endpoints: T
	handlers: HandlerTable<T>
	authenticate: (request: Request) => Promise<ApiPrincipal>
	/** Throws to refuse a client before anything else (an outdated mobile app). */
	checkClient?: (request: Request) => void
	/** Every request, per user; `null` disables it. */
	rateLimit?: ((userId: string) => RateResult) | null
	/**
	 * Per endpoint and user, checked before the body is read (saves, follows, exports). A request
	 * refused before its handler runs (invalid, too large, no upload slot) gets its hit back.
	 */
	limits?: Partial<Record<keyof T, (userId: string) => RateResult>>
	/**
	 * Requests with bodies over `LARGE_BODY` (captured pages) hold megabytes until they finish:
	 * at most this many at once, per user and in all, counted with the web's own uploads.
	 */
	largeBodies?: { perOwner: number; total: number }
	bodyTimeouts?: BodyTimeouts
	/** Check JSON responses against the contract: on in development and tests. */
	checkResponses?: boolean
	/** Unexpected errors go here; the default logs `describeError`, never the error's message. */
	log?: (message: string, error: unknown) => void
}

export type RouteMatch<T extends Record<string, Endpoint>> =
	| { kind: "route"; id: keyof T & string; endpoint: Endpoint; params: Record<string, string> }
	| { kind: "method"; allowed: string[] }
	| { kind: "none" }

interface CompiledRoute<T> {
	id: keyof T & string
	endpoint: Endpoint
	regex: RegExp
	names: string[]
}

function compile<T extends Record<string, Endpoint>>(endpoints: T): CompiledRoute<T>[] {
	const routes = Object.entries(endpoints).map(([id, endpoint]) => {
		const names: string[] = []
		const source = endpoint.path
			.split("/")
			.map((segment) => {
				if (segment.startsWith(":")) {
					names.push(segment.slice(1))
					return "([^/]+)"
				}
				return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
			})
			.join("/")
		return { id: id as keyof T & string, endpoint, regex: new RegExp(`^${source}$`), names }
	})
	// Literal paths before parameterized ones: /articles/lookup wins over /articles/:id.
	return routes.sort((a, b) => a.names.length - b.names.length)
}

/** The endpoint path inside the API: no prefix, no trailing slash. Null outside the API. */
export function apiPath(pathname: string): string | null {
	if (pathname !== API_PREFIX && !pathname.startsWith(`${API_PREFIX}/`)) return null
	const rest = pathname.slice(API_PREFIX.length).replace(/\/+$/, "")
	return rest || "/"
}

export function createApiRouter<T extends Record<string, Endpoint>>({
	endpoints,
	handlers,
	authenticate,
	checkClient,
	rateLimit = null,
	limits = {},
	largeBodies = LARGE_UPLOADS,
	bodyTimeouts = { idleMs: 30_000, totalMs: 120_000 },
	checkResponses = false,
	log = logError,
}: RouterOptions<T>) {
	const routes = compile(endpoints)

	/** Takes a slot for a large upload; the returned function gives it back. */
	function largeBodySlot(userId: string): () => void {
		const release = takeUploadSlot(userId, largeBodies)
		if (!release)
			throw ApiError.of("rate_limited", "Too many large uploads at once. Try again shortly.", {
				retryAfter: 2,
			})
		return release
	}

	function match(method: string, pathname: string): RouteMatch<T> {
		const path = apiPath(pathname)
		if (path === null) return { kind: "none" }
		const allowed = new Set<string>()
		// A path a literal route names (/articles/lookup) belongs to it, whatever the method: a
		// route with a parameter (/articles/:id) must not take it as an id.
		const matching = routes.filter((route) => route.regex.test(path))
		const literal = matching.filter((route) => route.names.length === 0)
		for (const route of literal.length > 0 ? literal : matching) {
			const m = route.regex.exec(path)
			if (!m) continue
			if (route.endpoint.method !== method) {
				allowed.add(route.endpoint.method)
				continue
			}
			const params: Record<string, string> = {}
			try {
				route.names.forEach((name, i) => {
					params[name] = decodeURIComponent(m[i + 1] ?? "")
				})
			} catch {
				return { kind: "none" }
			}
			return { kind: "route", id: route.id, endpoint: route.endpoint, params }
		}
		return allowed.size ? { kind: "method", allowed: [...allowed].sort() } : { kind: "none" }
	}

	/** What `handle` needs to know about a request that was refused. */
	interface RequestState {
		/** Authenticated: an unread body may be read up to `bodyLimit` before answering. */
		authenticated: boolean
		bodyLimit: number
	}

	async function dispatch(request: Request, state: RequestState): Promise<Response> {
		const url = new URL(request.url)
		const matched = match(request.method, url.pathname)
		if (matched.kind === "none") throw notFound("No such endpoint.")
		if (matched.kind === "method")
			throw ApiError.of(
				"method_not_allowed",
				`This endpoint takes ${matched.allowed.join(", ")}.`,
				{ headers: { Allow: matched.allowed.join(", ") } },
			)
		const { id, endpoint, params: rawParams } = matched
		// Before sign-in: an app too old to work says so, not that its token failed.
		checkClient?.(request)

		let auth: Auth = { principal: null }
		let refund: (() => void) | undefined
		const signedIn = () => {
			// From here on, a refusal (403, 429, …) reads the body up to the endpoint's limit first.
			state.authenticated = true
			state.bodyLimit = bodyLimitOf(endpoint)
		}
		if (endpoint.scope !== "none") {
			const principal = await authenticate(request)
			signedIn()
			if (endpoint.scope === "write" && principal.access !== "write")
				throw insufficientScope(LIBRARY_WRITE_SCOPE)
			// Limits come before the body is read, so refused uploads cost no memory.
			for (const check of [rateLimit, limits[id]]) {
				const limited = check?.(principal.userId) ?? { ok: true }
				if (!limited.ok) {
					refund?.()
					throw rateLimited(limited.retryAfterSeconds)
				}
				if (check !== rateLimit) refund = limited.refund
			}
			auth = { principal, userId: principal.userId, access: principal.access }
		} else signedIn()

		const slot = { release: () => {} }
		const progress = { bytes: 0 }
		try {
			let params: unknown = {}
			let query: unknown = {}
			let body: unknown
			try {
				params = endpoint.params ? validate("params", endpoint.params, rawParams) : {}
				query = endpoint.query
					? validate("query", endpoint.query, Object.fromEntries(url.searchParams))
					: {}
				if (endpoint.body) {
					const userId = auth.principal?.userId ?? ""
					const raw = await readJsonBody(request, bodyLimitOf(endpoint), {
						timeouts: bodyTimeouts,
						progress,
						onLarge: () => {
							slot.release = largeBodySlot(userId)
						},
					})
					body = validate("body", endpoint.body, raw)
				}
			} catch (error) {
				// Refused before any work: the request does not count against the endpoint's limit.
				// A large body read in full (and then found invalid) was work, though.
				if (progress.bytes <= LARGE_BODY) refund?.()
				throw error
			}
			const handler = handlers[id] as (ctx: unknown) => Promise<unknown>
			const result = await handler({ request, params, query, body, ...auth })
			return respond(id, endpoint.response, result)
		} finally {
			slot.release()
		}
	}

	function respond(id: string, kind: ResponseKind, result: unknown): Response {
		switch (kind.kind) {
			case "json": {
				const status = result instanceof Reply ? result.status : (kind.statuses[0] ?? 200)
				const data = result instanceof Reply ? result.data : result
				if (checkResponses) {
					if (!kind.statuses.includes(status))
						throw new Error(`${id} replied ${status}, which its contract does not list`)
					const parsed = kind.schema.safeParse(data)
					if (!parsed.success)
						throw new Error(
							`${id} response does not match the contract:\n${z.prettifyError(parsed.error)}`,
						)
				}
				return new Response(JSON.stringify(data), {
					status,
					headers: {
						"content-type": "application/json; charset=utf-8",
						"cache-control": "no-store",
					},
				})
			}
			case "text":
				return new Response(String(result), {
					headers: { "content-type": kind.contentType, "cache-control": "no-store" },
				})
			case "binary":
				return result as Response
			case "events":
				return eventStream(result as AsyncIterable<unknown>)
			case "empty":
				return new Response(null, { status: 204 })
		}
	}

	async function handle(request: Request): Promise<Response> {
		const state: RequestState = { authenticated: false, bodyLimit: UNAUTHENTICATED_BODY_LIMIT }
		let response: Response
		try {
			response = await dispatch(request, state)
		} catch (error) {
			if (error instanceof AppError) response = errorResponse(error)
			else {
				// Bodies may carry captured HTML and notes: log the route, never the request.
				log(`[api] ${request.method} ${new URL(request.url).pathname}`, error)
				response = errorResponse(ApiError.of("internal", "Something went wrong on our side."))
			}
		}
		// A body left unread (the request was refused early) is read and thrown away first: a client
		// still sending it would otherwise see a broken pipe instead of this answer. Before sign-in,
		// only a small one; past what is read, the connection closes after the answer.
		const drained = await discardBody(
			request,
			state.authenticated ? state.bodyLimit : UNAUTHENTICATED_BODY_LIMIT,
			state.authenticated ? bodyTimeouts : UNAUTHENTICATED_TIMEOUTS,
		)
		return drained ? response : closing(response)
	}

	return { handle, match }
}

function validate(where: "params" | "query" | "body", schema: z.ZodType, value: unknown): unknown {
	const result = schema.safeParse(value)
	if (result.success) return result.data
	throw ApiError.of("invalid_request", `Invalid ${where}.`, {
		details: { where, issues: result.error.issues },
	})
}

/** The same response, telling the client (and Node) to close the connection after it. */
function closing(response: Response): Response {
	if (response.headers.get("connection") === "close") return response
	const headers = new Headers(response.headers)
	headers.set("connection", "close")
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	})
}

const DEFAULT_TIMEOUTS: BodyTimeouts = { idleMs: 30_000, totalMs: 120_000 }
/** Draining for a request that never signed in is kept short. */
const UNAUTHENTICATED_TIMEOUTS: BodyTimeouts = { idleMs: 5_000, totalMs: 10_000 }

/**
 * The JSON body, read with a byte cap (`readBody`). A body over the cap, or one that stalls or
 * takes too long (`request_timeout`), is answered without reading the rest, and the connection
 * closes after the answer. `onLarge` runs once the body is known to exceed `LARGE_BODY`; when it
 * throws, the rest of the body is read and thrown away before the error goes out. `progress.bytes`
 * counts what was read, also when this throws. An empty body is `undefined` (the schema then
 * complains).
 */
export async function readJsonBody(
	request: Request,
	limit: number,
	{
		timeouts = DEFAULT_TIMEOUTS,
		onLarge,
		progress = { bytes: 0 },
	}: { timeouts?: BodyTimeouts; onLarge?: () => void; progress?: { bytes: number } } = {},
): Promise<unknown> {
	let bytes: Uint8Array | undefined
	try {
		bytes = await readBody(request, limit, { timeouts, largeAt: LARGE_BODY, onLarge, progress })
	} catch (error) {
		if (!(error instanceof BodyRefusal)) throw error
		throw refused(error, limit)
	}
	if (!bytes) return undefined
	try {
		return JSON.parse(new TextDecoder().decode(bytes))
	} catch {
		throw ApiError.of("invalid_request", "The body is not valid JSON.")
	}
}

/** The API's error for a refused body. */
function refused(refusal: BodyRefusal, limit: number): unknown {
	const error =
		refusal.reason === "large_refused"
			? refusal.cause
			: refusal.reason === "too_large"
				? ApiError.of("too_large", `The body may not exceed ${limit} bytes.`)
				: refusal.reason === "too_slow"
					? ApiError.of("request_timeout", "The body took too long to arrive.")
					: ApiError.of("invalid_request", "The body could not be read.")
	if (refusal.unread && error instanceof ApiError) error.closeConnection = true
	return error
}
