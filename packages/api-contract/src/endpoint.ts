import type { z } from "zod"
import type { ErrorCode } from "./errors"

export type Scope = "read" | "write" | "none"
export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE"
export type JsonStatus = 200 | 201 | 202

export type ResponseKind =
	/** The first status is the default; a handler picks another with `reply(status, data)`. */
	| { kind: "json"; schema: z.ZodType; statuses: readonly JsonStatus[] }
	| { kind: "text"; contentType: string }
	/** A file (images, the export): the handler returns the whole Response. */
	| { kind: "binary" }
	/**
	 * Server-sent events (`text/event-stream`): one JSON value of `schema` per `data:` line, sent
	 * as it comes. The handler returns them as an async iterable; refusals come before the first.
	 */
	| { kind: "events"; schema: z.ZodType }
	/** 204 */
	| { kind: "empty" }

export function json<S extends z.ZodType>(schema: S, statuses: readonly JsonStatus[] = [200]) {
	return { kind: "json" as const, schema, statuses }
}
export const text = (contentType: string) => ({ kind: "text", contentType }) as const
export const binary = () => ({ kind: "binary" }) as const
export const events = <S extends z.ZodType>(schema: S) => ({ kind: "events" as const, schema })
export const empty = () => ({ kind: "empty" }) as const

export interface EndpointShape {
	/** `<group>.<action>`, the key in `endpoints` and the OpenAPI operationId. */
	id: string
	method: Method
	/** Relative to /api/v1; path params as `:name`. */
	path: `/${string}`
	scope: Scope
	/**
	 * Only OAuth tokens issued to one of these clients may call it; API keys and other clients get
	 * `403 forbidden`. A product rule (who spends the account's AI), not a scope: no consent grants it.
	 */
	clients?: readonly string[]
	params?: z.ZodObject
	query?: z.ZodObject
	body?: z.ZodType
	response: ResponseKind
	/** Besides the ones every endpoint can return (`COMMON_ERRORS`). */
	errors: readonly ErrorCode[]
	/** One line for the OpenAPI document. */
	summary?: string
	/** Largest request body in bytes (UTF-8 JSON); `JSON_BODY_LIMIT` when omitted. */
	bodyLimit?: number
	/**
	 * Safe to send again when a large upload breaks and the token turns out to be refused: the
	 * request may have reached the server before the token expired, so only endpoints where a repeat
	 * does no harm say so.
	 */
	retryOnCutoff?: boolean
}

/** Largest JSON request body, in bytes, for endpoints that do not set their own. */
export const JSON_BODY_LIMIT = 1024 * 1024

export const bodyLimitOf = (endpoint: EndpointShape) => endpoint.bodyLimit ?? JSON_BODY_LIMIT

/**
 * The most a request refused before authentication (a bad or expired token) has read from its
 * body. Larger bodies are cut off with the answer, which a client still sending may see as a broken
 * connection: the SDK then asks whether its token is the problem.
 */
export const UNAUTHENTICATED_BODY_LIMIT = JSON_BODY_LIMIT

/** Bytes in the UTF-8 encoding of a string, without encoding it. */
export function utf8Length(s: string): number {
	let bytes = 0
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i)
		if (c < 0x80) bytes += 1
		else if (c < 0x800) bytes += 2
		else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
			const next = s.charCodeAt(i + 1)
			if (next >= 0xdc00 && next <= 0xdfff) {
				bytes += 4
				i++
			} else bytes += 3
		} else bytes += 3
	}
	return bytes
}

export function defineEndpoint<const E extends EndpointShape>(e: E): E {
	return e
}

export type Endpoint = EndpointShape

// What a handler receives (after parsing) and what the SDK accepts (before parsing).
export type InferParams<E> = E extends { params: infer P extends z.ZodType }
	? z.output<P>
	: Record<string, never>
export type InferQuery<E> = E extends { query: infer Q extends z.ZodType }
	? z.output<Q>
	: Record<string, never>
export type InferBody<E> = E extends { body: infer B extends z.ZodType } ? z.output<B> : undefined
export type InputParams<E> = E extends { params: infer P extends z.ZodType }
	? z.input<P>
	: Record<string, never>
export type InputBody<E> = E extends { body: infer B extends z.ZodType } ? z.input<B> : undefined
/**
 * Query strings are text: the SDK stringifies numbers and booleans before checking them. Each
 * value keeps its parsed type (an enum's choices, a number, a boolean), or that type as text.
 */
export type InputQuery<E> = E extends { query: infer Q extends z.ZodType }
	? QueryInput<z.input<Q>, z.output<Q>>
	: Record<string, never>

type QueryValue<T> = [T] extends [boolean]
	? boolean | "true" | "false"
	: [T] extends [number]
		? number | `${number}`
		: [T] extends [string]
			? T
			: string
/** Keys a caller may leave out: optional, defaulted, or coerced (which takes anything). */
type OmittableKeys<In> = { [K in keyof In]-?: undefined extends In[K] ? K : never }[keyof In]
type QueryInput<In, Out> = {
	[K in Exclude<keyof Out, OmittableKeys<In>>]: QueryValue<Exclude<Out[K], undefined>>
} & {
	[K in OmittableKeys<In> & keyof Out]?: QueryValue<Exclude<Out[K], undefined>> | null
}

/** What a json endpoint's response parses to. */
export type JsonOutput<E> = E extends {
	response: { kind: "json"; schema: infer S extends z.ZodType }
}
	? z.output<S>
	: never
export type JsonInput<E> = E extends {
	response: { kind: "json"; schema: infer S extends z.ZodType }
}
	? z.input<S>
	: never

/** One event of an events endpoint, as sent (`EventInput`) and as read (`EventOutput`). */
export type EventOutput<E> = E extends {
	response: { kind: "events"; schema: infer S extends z.ZodType }
}
	? z.output<S>
	: never
export type EventInput<E> = E extends {
	response: { kind: "events"; schema: infer S extends z.ZodType }
}
	? z.input<S>
	: never

/** What the SDK returns for an endpoint. */
export type InferResponse<E> = E extends { response: { kind: "json" } }
	? JsonOutput<E>
	: E extends { response: { kind: "text" } }
		? string
		: E extends { response: { kind: "binary" } }
			? Response
			: E extends { response: { kind: "events" } }
				? AsyncIterable<EventOutput<E>>
				: undefined
