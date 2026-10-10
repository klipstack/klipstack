import { ERROR_STATUS, type ErrorBody, type ErrorCode } from "@klipstack/api-contract"
import type { z } from "zod"

/**
 * A refused change, and the one error type commands throw. The API, the web app's actions and MCP
 * each turn it into their own answer. `message` is English, for people and assistants; the web app
 * shows its own text for the `code`.
 */
export class AppError extends Error {
	readonly code: ErrorCode
	readonly details: Record<string, unknown> | undefined
	/** Seconds; sent as `Retry-After` too. */
	readonly retryAfter: number | undefined

	constructor(
		code: ErrorCode,
		message: string,
		{ details, retryAfter }: { details?: Record<string, unknown>; retryAfter?: number } = {},
	) {
		super(message)
		this.name = "AppError"
		this.code = code
		this.details = details
		this.retryAfter = retryAfter
	}

	get status(): number {
		return ERROR_STATUS[this.code]
	}

	/** The `error` of every error body: the API's and the web actions'. */
	get body(): ErrorBody["error"] {
		return {
			code: this.code,
			message: this.message,
			...(this.retryAfter !== undefined ? { retryAfter: this.retryAfter } : {}),
			...(this.details ? { details: this.details } : {}),
		}
	}
}

export const notFound = (message: string) => new AppError("not_found", message)

export function rateLimited(retryAfter: number, what = "requests"): AppError {
	return new AppError("rate_limited", `Too many ${what}. Try again in ${retryAfter} seconds.`, {
		retryAfter,
	})
}

/** The input as `schema` reads it, or `invalid_request` with zod's issues. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
	const result = schema.safeParse(input)
	if (result.success) return result.data
	const first = result.error.issues[0]?.message
	throw new AppError("invalid_request", first ?? "The request is not valid.", {
		details: { issues: result.error.issues },
	})
}
