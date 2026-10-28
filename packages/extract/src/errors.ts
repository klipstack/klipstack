export type ExtractErrorCode =
	| "invalid_url"
	| "blocked_host"
	| "fetch_failed"
	| "timeout"
	| "http_error"
	| "not_html"
	| "too_large"
	| "too_many_redirects"
	| "no_content"
	/** The site sent a bot check (a CAPTCHA, a browser check) in place of the page. */
	| "bot_check"
	| "not_feed"
	| "not_opml"

export class ExtractError extends Error {
	readonly code: ExtractErrorCode
	readonly status?: number
	/** Seconds the server asked to wait (`Retry-After`), when it did. */
	readonly retryAfter?: number | null
	constructor(
		code: ExtractErrorCode,
		message: string,
		options?: { status?: number; retryAfter?: number | null; cause?: unknown },
	) {
		super(message, options?.cause ? { cause: options.cause } : undefined)
		this.name = "ExtractError"
		this.code = code
		this.status = options?.status
		this.retryAfter = options?.retryAfter
	}
}
