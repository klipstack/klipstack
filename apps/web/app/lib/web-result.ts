import type { ErrorBody } from "@klipstack/api-contract"

/**
 * What the web app's actions answer (`lib/web-action.server.ts`): `ok` and the result, or `ok:
 * false` and the same `error` as the API's error body. Safe to import from client code.
 */
export type WebResult<T extends object = object> =
	| ({ ok: true } & T)
	| { ok: false; error: ErrorBody["error"] }

/** A web action's refusal, when `data` is one. */
export function refusal(data: unknown): ErrorBody["error"] | null {
	if (!data || typeof data !== "object") return null
	const { ok, error } = data as { ok?: unknown; error?: unknown }
	if (ok !== false || !error || typeof error !== "object") return null
	return typeof (error as { code?: unknown }).code === "string"
		? (error as ErrorBody["error"])
		: null
}
