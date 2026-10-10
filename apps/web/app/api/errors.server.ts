import type { ErrorBody, ErrorCode } from "@klipstack/api-contract"
import { AppError } from "~/lib/app-error"

/**
 * An error only the API answers with: about the request itself (a token, a scope, the body, a
 * route), not about a change. It can carry headers, and close the connection. Commands throw
 * `AppError`; the router answers both (`errorResponse`), and anything else as `500 internal`.
 */
export class ApiError extends AppError {
	/** Extra headers, such as `WWW-Authenticate` on 401 and 403. */
	readonly headers: Record<string, string> | undefined
	/**
	 * Close the connection after this answer: the request body was not read to its end, and the
	 * client may still be sending it.
	 */
	closeConnection = false

	constructor(
		code: ErrorCode,
		message: string,
		options: {
			details?: Record<string, unknown>
			retryAfter?: number
			headers?: Record<string, string>
		} = {},
	) {
		super(code, message, options)
		this.name = "ApiError"
		this.headers = options.headers
	}

	static of(code: ErrorCode, message: string, opts?: ConstructorParameters<typeof ApiError>[2]) {
		return new ApiError(code, message, opts)
	}
}

/** The error body with its status and headers. */
export function errorResponse(error: AppError): Response {
	const body: ErrorBody = { error: error.body }
	const headers = new Headers(error instanceof ApiError ? error.headers : undefined)
	if (error.retryAfter !== undefined) headers.set("retry-after", String(error.retryAfter))
	if (error instanceof ApiError && error.closeConnection) headers.set("connection", "close")
	headers.set("content-type", "application/json; charset=utf-8")
	headers.set("cache-control", "no-store")
	return new Response(JSON.stringify(body), { status: error.status, headers })
}

export const notFound = (message = "Not found.") => ApiError.of("not_found", message)

const REALM = 'Bearer realm="klipstack"'

/** 401: no usable token. `invalidToken` adds RFC 6750's `error="invalid_token"`. */
export function unauthorized(message: string, invalidToken: boolean): ApiError {
	return ApiError.of("unauthorized", message, {
		headers: { "WWW-Authenticate": invalidToken ? `${REALM}, error="invalid_token"` : REALM },
	})
}

/** 403: the token lacks a scope the endpoint needs. */
export function insufficientScope(scope: string): ApiError {
	return ApiError.of("insufficient_scope", `This token needs the ${scope} scope.`, {
		headers: { "WWW-Authenticate": `${REALM}, error="insufficient_scope", scope="${scope}"` },
	})
}

export function rateLimited(retryAfterSeconds: number): ApiError {
	return ApiError.of(
		"rate_limited",
		`Too many requests. Try again in ${retryAfterSeconds} seconds.`,
		{
			retryAfter: retryAfterSeconds,
		},
	)
}
