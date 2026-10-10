import { data } from "react-router"
import { AppError } from "./app-error"

/**
 * A command's refusal as a web action answers it: `{ok: false, error}` with the code's status and,
 * for a rate limit, `Retry-After`. The page picks its text by `error.code`. `extra` goes along
 * (what the form had, to show it again).
 */
export function refused<T extends object = object>(error: AppError, extra?: T) {
	return data(
		{ ...(extra as T), ok: false as const, error: error.body },
		{
			status: error.status,
			headers:
				error.retryAfter === undefined ? undefined : { "retry-after": String(error.retryAfter) },
		},
	)
}

/**
 * Runs a web action's command: `{ok: true, …result}` (with `status`, such as 201 for something
 * created), or its refusal (see `refused`).
 */
export async function answer<T extends object>(run: () => Promise<T>, status?: number) {
	try {
		const result = { ok: true as const, ...(await run()) }
		return status === undefined ? result : data(result, { status })
	} catch (error) {
		if (error instanceof AppError) return refused(error)
		throw error
	}
}
