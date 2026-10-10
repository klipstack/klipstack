import { APIError } from "better-auth/api"

/**
 * How long after signing in a browser session may add durable access (an API key, a newly
 * connected app) or delete the account. A stolen or forgotten session older than this must sign in
 * again first: otherwise it could leave behind a key that outlives a password reset. Admin writes
 * use the same window. `session.created_at` is the sign-in time: refreshes keep it.
 */
export const RECENT_SIGN_IN_MS = 30 * 60 * 1000

export function signedInRecently(createdAt: Date | string | null | undefined, now = Date.now()) {
	const at = createdAt ? new Date(createdAt).getTime() : Number.NaN
	// An unknown or future time is not a recent sign-in.
	return Number.isFinite(at) && at <= now && now - at <= RECENT_SIGN_IN_MS
}

export function reauthenticationRequired(): APIError {
	return new APIError("FORBIDDEN", {
		code: "REAUTHENTICATION_REQUIRED",
		message: "Sign in again to continue.",
	})
}
