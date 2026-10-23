import {
	bodyLimitOf,
	type Endpoint,
	ErrorBody,
	getMe,
	type InferResponse,
	type InputBody,
	type InputParams,
	type InputQuery,
	type ResponseKind,
	UNAUTHENTICATED_BODY_LIMIT,
} from "@klipstack/api-contract"
import type { z } from "zod"
import { KlipstackApiError, KlipstackContractError, KlipstackInputError } from "./errors"
import { sseData } from "./events"

/**
 * Returns the current access token. The SDK asks with `refresh: true` once after a 401,
 * so an OAuth caller can refresh its access token; the caller owns the refresh flow.
 */
export type TokenProvider = (ctx: { refresh: boolean }) => string | Promise<string>

export interface ClientOptions {
	/** The Klipstack origin, e.g. `https://klipstack.com`. */
	baseUrl: string
	token: TokenProvider
	/** Sent as the User-Agent (ignored by browsers, which send their own). */
	userAgent?: string
	/** Sent with every request, e.g. the mobile app's `X-Klipstack-Client`. */
	headers?: Record<string, string>
	fetch?: typeof fetch
	/**
	 * Cancels every request of this client once aborted, including reading a streamed download.
	 * `AbortSignal.timeout(ms)` makes it a timeout.
	 */
	signal?: AbortSignal
}

/** What `call` takes: `params`, `body` and required query values only where the endpoint has them. */
export type CallInput<E> = (E extends { params: z.ZodType }
	? { params: InputParams<E> }
	: { params?: never }) &
	(E extends { body: z.ZodType } ? { body: InputBody<E> } : { body?: never }) &
	(E extends { query: z.ZodType }
		? Record<never, never> extends InputQuery<E>
			? { query?: InputQuery<E> }
			: { query: InputQuery<E> }
		: { query?: never }) & {
		/** Cancels this request (with the client's own signal, whichever aborts first). */
		signal?: AbortSignal
	}

export type Caller<T extends Record<string, Endpoint>> = <K extends keyof T & string>(
	id: K,
	...input: Record<never, never> extends CallInput<T[K]>
		? [input?: CallInput<T[K]>]
		: [input: CallInput<T[K]>]
) => Promise<InferResponse<T[K]>>

interface UntypedInput {
	params?: Record<string, unknown>
	query?: Record<string, unknown>
	body?: unknown
	signal?: AbortSignal
}

const API_PREFIX = "/api/v1"
const encoder = new TextEncoder()

/**
 * A generic, contract-typed call: checks the input, sends the request, retries once with a fresh
 * token after a 401, maps error bodies to `KlipstackApiError` and checks JSON responses.
 */
export function createCaller<T extends Record<string, Endpoint>>(
	table: T,
	{
		baseUrl,
		token,
		userAgent,
		headers: extraHeaders,
		fetch: fetchImpl = globalThis.fetch,
		signal: clientSignal,
	}: ClientOptions,
): Caller<T> {
	const base = baseUrl.replace(/\/+$/, "")

	return async function call(id: keyof T & string, input: UntypedInput = {}) {
		const endpoint = table[id]
		if (!endpoint) throw new Error(`Unknown endpoint ${String(id)}`)
		const signals = [clientSignal, input.signal].filter((s): s is AbortSignal => s !== undefined)
		const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0]
		signal?.throwIfAborted()
		const params: Record<string, unknown> = input.params ?? {}
		if (endpoint.params) check("params", endpoint.params, params)
		const query = queryStrings(input.query ?? {})
		if (endpoint.query) check("query", endpoint.query, query)
		if (endpoint.body) check("body", endpoint.body, input.body)
		// The server refuses larger bodies without reading them, and Node's fetch then reports a
		// broken pipe instead of the 413: check the size here.
		const payload = endpoint.body ? encoder.encode(JSON.stringify(input.body)) : undefined
		if (payload && payload.byteLength > bodyLimitOf(endpoint))
			throw new KlipstackInputError("body", [
				{
					code: "custom",
					path: [],
					message: `The request body is ${payload.byteLength} bytes; this endpoint takes at most ${bodyLimitOf(endpoint)}.`,
					input: undefined,
				},
			])

		const url = new URL(`${base}${API_PREFIX}${fillPath(endpoint.path, params)}`)
		for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)

		// The token in use, asked for once; `renew` has the provider refresh it.
		let current = endpoint.scope === "none" ? "" : await token({ refresh: false })
		let renewed = false
		const renew = async () => {
			current = await token({ refresh: true })
			renewed = true
		}
		const headersFor = (accept: string) => {
			const headers = new Headers(extraHeaders)
			headers.set("accept", accept)
			if (endpoint.scope !== "none") headers.set("authorization", `Bearer ${current}`)
			if (userAgent) headers.set("user-agent", userAgent)
			return headers
		}
		const send = () => {
			const headers = headersFor(acceptFor(endpoint.response))
			const init: RequestInit = { method: endpoint.method, headers, signal }
			if (payload) {
				headers.set("content-type", "application/json")
				init.body = payload
			}
			return fetchImpl(url, init)
		}
		/** The 401 the server gives the current token, or null when it takes it (or cannot be asked). */
		const rejection = async (): Promise<Response | null> => {
			try {
				const res = await fetchImpl(new URL(`${base}${API_PREFIX}${getMe.path}`), {
					headers: headersFor("application/json"),
					signal,
				})
				if (res.status === 401) return res
				await res.body?.cancel()
			} catch {
				// Unreachable (or cancelled): whatever failed stands.
			}
			signal?.throwIfAborted()
			return null
		}

		// Before sign-in the server reads only a small body, then answers and closes the connection.
		// A client still sending a larger one gets a broken connection instead of the 401 (or, behind
		// a proxy, a 502). So a large body goes out only with a token the server takes.
		const large =
			endpoint.scope !== "none" && (payload?.byteLength ?? 0) > UNAUTHENTICATED_BODY_LIMIT
		if (large) {
			const refused = await rejection()
			if (refused) {
				await refused.body?.cancel()
				await renew()
				const still = await rejection()
				if (still) throw await toApiError(still)
			}
		}

		let response: Response | undefined
		let failure: unknown
		const attempt = async () => {
			failure = undefined
			try {
				response = await send()
			} catch (error) {
				response = undefined
				failure = error
			}
		}
		await attempt()
		// A large upload that broke anyway (the token expired meanwhile, or a proxy answered for the
		// server): when the token is the problem, refresh it, and send again only where that is safe.
		if (large && (failure !== undefined || (response && fromProxy(response)))) {
			const refused = await rejection()
			if (refused) {
				if (renewed || !endpoint.retryOnCutoff) throw await toApiError(refused)
				await refused.body?.cancel()
				await response?.body?.cancel()
				await renew()
				await attempt()
				const still = failure !== undefined ? await rejection() : null
				if (still) throw await toApiError(still)
			}
		}
		if (failure !== undefined) throw failure
		if (!response) throw new Error("No response")
		if (response.status === 401 && endpoint.scope !== "none" && !renewed) {
			// Refused before any work: safe to send again with a fresh token.
			await response.body?.cancel()
			await renew()
			response = await send()
		}
		if (!response.ok) throw await toApiError(response)
		return read(id, endpoint.response, response) as Promise<InferResponse<T[typeof id]>>
	} as Caller<T>
}

function check(where: KlipstackInputError["where"], schema: z.ZodType, value: unknown) {
	const result = schema.safeParse(value)
	if (!result.success) throw new KlipstackInputError(where, result.error.issues)
}

/** Query values as the wire carries them; absent ones are left out. */
function queryStrings(query: Record<string, unknown>): Record<string, string> {
	const out: Record<string, string> = {}
	for (const [key, value] of Object.entries(query))
		if (value !== undefined && value !== null) out[key] = String(value)
	return out
}

function fillPath(path: string, params: Record<string, unknown>): string {
	return path.replace(/:(\w+)/g, (_m, name: string) => encodeURIComponent(String(params[name])))
}

function acceptFor(response: ResponseKind): string {
	if (response.kind === "json") return "application/json"
	if (response.kind === "text") return response.contentType.split(";")[0] ?? "*/*"
	if (response.kind === "events") return "text/event-stream"
	return "*/*"
}

/** A gateway error that is not ours (no JSON error body): a proxy answering for the server. */
function fromProxy(response: Response): boolean {
	return (
		[502, 503, 504].includes(response.status) &&
		!(response.headers.get("content-type") ?? "").includes("application/json")
	)
}

async function toApiError(response: Response): Promise<KlipstackApiError> {
	const text = await response.text().catch(() => "")
	try {
		const parsed = ErrorBody.safeParse(JSON.parse(text))
		if (parsed.success) {
			const { code, message, retryAfter, details } = parsed.data.error
			return new KlipstackApiError(response.status, code, message, { retryAfter, details })
		}
	} catch {
		// not JSON: a proxy or a crash page
	}
	const hint = text.trim().slice(0, 200)
	return new KlipstackApiError(
		response.status,
		"unknown",
		`HTTP ${response.status}${hint ? `: ${hint}` : ""}`,
	)
}

async function read(id: string, kind: ResponseKind, response: Response): Promise<unknown> {
	switch (kind.kind) {
		case "json": {
			const data: unknown = await response.json()
			// Default zod objects drop unknown keys, so a new server field never breaks an older client.
			const parsed = kind.schema.safeParse(data)
			if (!parsed.success) throw new KlipstackContractError(id, parsed.error.issues)
			return parsed.data
		}
		case "text":
			return response.text()
		case "binary":
			return response
		case "events":
			return checkedEvents(id, kind.schema, response)
		case "empty":
			await response.body?.cancel()
			return undefined
	}
}

/**
 * An events endpoint's events as they arrive, each checked against the contract. An event of a
 * type this version does not know is skipped: a new kind of event never breaks an older client.
 */
async function* checkedEvents(id: string, schema: z.ZodType, response: Response) {
	if (!response.body) return
	for await (const value of sseData(response.body)) {
		const parsed = schema.safeParse(value)
		if (parsed.success) yield parsed.data
		else if (!parsed.error.issues.every(unknownType))
			throw new KlipstackContractError(id, parsed.error.issues)
	}
}

const unknownType = (issue: z.core.$ZodIssue) =>
	issue.code === "invalid_union" && issue.path.length === 1 && issue.path[0] === "type"
