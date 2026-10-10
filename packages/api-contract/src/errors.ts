import { z } from "zod"

/**
 * Every error code Klipstack answers with (the API, MCP and the web app's actions), with its HTTP
 * status. `code` is stable; `message` is for people.
 */
export const ERROR_STATUS = {
	invalid_request: 400,
	/** A highlight's new range is not a passage of the article (its ends, its length). */
	invalid_range: 400,
	unauthorized: 401,
	insufficient_scope: 403,
	/** Admin pages and changes: the account is not an administrator (any more). */
	forbidden: 403,
	/** The account's email is not verified yet: needed for API keys and connected apps. */
	verification_required: 403,
	/** The session is too old for this: sign in again. */
	reauthentication_required: 403,
	/**
	 * The account is at one of its caps (`details.limit`: saves, storage, feeds, editions, ai), with
	 * `details.max` and, for the monthly ones, `details.resetsAt`. Waiting a moment does not help.
	 */
	limit_reached: 403,
	not_found: 404,
	method_not_allowed: 405,
	request_timeout: 408,
	already_saved: 409,
	already_added: 409,
	/** The article an edition item came from is gone. */
	document_gone: 409,
	not_published: 409,
	/** An admin took the edition down after a report: it cannot be published again. */
	edition_removed: 409,
	/** Admin: an invite that was used cannot be revoked. */
	invite_used: 409,
	/** Admin retries: why the work cannot be queued again. */
	not_failed: 409,
	already_pending: 409,
	trashed: 409,
	superseded: 409,
	already_done: 409,
	/** The article or the highlight changed since the client read it: nothing was changed. */
	version_changed: 409,
	highlight_changed: 409,
	ambiguous_quote: 409,
	choose_feed: 409,
	name_taken: 409,
	note_changed: 409,
	tag_in_saved_searches: 409,
	too_large: 413,
	invalid_url: 422,
	unsupported_twitter: 422,
	unsupported_youtube: 422,
	not_ready: 422,
	note_too_long: 422,
	no_match: 422,
	not_feed: 422,
	fetch_failed: 422,
	not_opml: 422,
	no_feeds: 422,
	/** The article has no http(s) address to link to. */
	no_url: 422,
	/** An edition item would quote more of its article than it may. */
	quote_cap: 422,
	/** What keeps an edition from being published (`details.problems`). */
	publish_problems: 422,
	too_many_tags: 422,
	too_many_article_tags: 422,
	too_many_saved_searches: 422,
	/** Only for the mobile app, when its `X-Klipstack-Client` version is below the minimum. */
	client_outdated: 426,
	rate_limited: 429,
	internal: 500,
	/** A service the change needs is down. */
	unavailable: 503,
} as const satisfies Record<string, number>

export type ErrorCode = keyof typeof ERROR_STATUS
export const ERROR_CODES = Object.keys(ERROR_STATUS) as ErrorCode[]

/**
 * Errors any endpoint can return; endpoints list only their own on top of these. `too_large` and
 * `request_timeout` come with every endpoint that takes a body. `not_found` and
 * `method_not_allowed` for an unknown route are not about any endpoint.
 */
export const COMMON_ERRORS: readonly ErrorCode[] = [
	"invalid_request",
	"unauthorized",
	"insufficient_scope",
	"rate_limited",
	"client_outdated",
	"internal",
]

export const ErrorBody = z
	.object({
		error: z.object({
			code: z.string(),
			message: z.string(),
			/** Seconds; only with 429, together with a Retry-After header. */
			retryAfter: z.number().optional(),
			details: z.record(z.string(), z.unknown()).optional(),
		}),
	})
	.meta({ id: "Error" })
export type ErrorBody = z.infer<typeof ErrorBody>
