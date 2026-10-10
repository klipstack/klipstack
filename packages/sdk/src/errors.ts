import { type DetailedErrorCode, ERROR_DETAILS, type ErrorDetails } from "@klipstack/api-contract"
import type { z } from "zod"

/** The server answered with an error body: `status` and `code` say what went wrong. */
export class KlipstackApiError extends Error {
	readonly status: number
	readonly code: string
	/** Seconds to wait; only with 429. */
	readonly retryAfter: number | null
	readonly details: Record<string, unknown> | null

	constructor(
		status: number,
		code: string,
		message: string,
		{ retryAfter, details }: { retryAfter?: number; details?: Record<string, unknown> } = {},
	) {
		super(message)
		this.name = "KlipstackApiError"
		this.status = status
		this.code = code
		this.retryAfter = retryAfter ?? null
		this.details = details ?? null
	}
}

/** The input fails the contract's checks: nothing was sent. */
export class KlipstackInputError extends Error {
	readonly where: "params" | "query" | "body"
	readonly issues: z.core.$ZodIssue[]

	constructor(where: KlipstackInputError["where"], issues: z.core.$ZodIssue[]) {
		super(
			`Invalid ${where}: ${issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
		)
		this.name = "KlipstackInputError"
		this.where = where
		this.issues = issues
	}
}

/** The response does not match the contract this client was built with: update the client. */
export class KlipstackContractError extends Error {
	readonly issues: z.core.$ZodIssue[]

	constructor(endpointId: string, issues: z.core.$ZodIssue[]) {
		super(
			`The response of ${endpointId} does not match this client's contract. Update the client. ${issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
		)
		this.name = "KlipstackContractError"
		this.issues = issues
	}
}

/**
 * A batch call split into several requests failed after some of them succeeded. `completed` holds
 * what the successful requests reported; `unsent` the ids whose request failed or was never sent.
 * `cause` is the error that stopped it (usually a KlipstackApiError).
 */
export class KlipstackBatchError<R = Record<string, unknown[]>> extends Error {
	readonly completed: R
	readonly unsent: string[]

	constructor(cause: unknown, completed: R, unsent: string[]) {
		super(
			`The batch stopped after ${unsent.length} ids were left: ${cause instanceof Error ? cause.message : String(cause)}`,
			{ cause },
		)
		this.name = "KlipstackBatchError"
		this.completed = completed
		this.unsent = unsent
	}
}

/**
 * The typed `details` of an API error with this code, or null (another error, another code, or
 * details this client cannot read). E.g. `errorDetails(e, "ambiguous_quote")?.candidates`.
 */
export function errorDetails<C extends DetailedErrorCode>(
	error: unknown,
	code: C,
): ErrorDetails<C> | null {
	if (!(error instanceof KlipstackApiError) || error.code !== code) return null
	const parsed = ERROR_DETAILS[code].safeParse(error.details)
	return parsed.success ? (parsed.data as ErrorDetails<C>) : null
}
