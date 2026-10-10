/**
 * Small in-process sliding-window limiter. Good enough for one web machine at friends scale;
 * swap for a Postgres/Redis implementation when there are several.
 */
const buckets = new Map<string, number[]>()

/**
 * Counts a hit and says whether it is within the limit. `refund` takes that hit back, for requests
 * refused before doing any work.
 */
export function rateLimit(
	key: string,
	limit: number,
	windowMs: number,
): { ok: true; refund: () => void } | { ok: false; retryAfterSeconds: number } {
	const now = Date.now()
	const cutoff = now - windowMs
	const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff)
	if (hits.length >= limit) {
		const oldest = hits[0] as number
		buckets.set(key, hits)
		return {
			ok: false,
			retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
		}
	}
	hits.push(now)
	buckets.set(key, hits)
	if (buckets.size > 10_000) {
		for (const [k, v] of buckets) if (v.every((t) => t <= cutoff)) buckets.delete(k)
	}
	let refunded = false
	return {
		ok: true,
		refund: () => {
			if (refunded) return
			refunded = true
			const current = buckets.get(key)
			const at = current?.lastIndexOf(now) ?? -1
			if (current && at >= 0) current.splice(at, 1)
		},
	}
}

/**
 * Whether one more hit would be within the limit, without counting it: for refusing a request
 * before its body is read, when the command that does the work counts the hit itself.
 */
export function peekRateLimit(
	key: string,
	limit: number,
	windowMs: number,
): { ok: true; refund: () => void } | { ok: false; retryAfterSeconds: number } {
	const peek = rateLimit(key, limit, windowMs)
	if (peek.ok) peek.refund()
	return peek.ok ? { ok: true, refund: () => {} } : peek
}

/** Saves per user (key `save:`), wherever they come from: the web, the extension, the API, MCP. */
export const SAVE_LIMIT = { limit: 120, windowMs: 60 * 60 * 1000 }

/** MCP requests per user: agents fire bursts of tool calls, but not sustained floods. */
export const MCP_LIMIT = { limit: 120, windowMs: 60 * 1000 }

/** HTTP API requests per user (key `api:`): scripts and the CLI, which page through lists. */
export const API_LIMIT = { limit: 300, windowMs: 60 * 1000 }

/** Exports per user (key `export:`): each one builds the whole library in memory. */
export const EXPORT_LIMIT = { limit: 6, windowMs: 60 * 60 * 1000 }

/** OPML imports per user (key `opml-import:`): each one may queue hundreds of feed fetches. */
export const OPML_IMPORT_LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 }

/** Refused bearer tokens per client address (key `bad-bearer:`): each one cost a database lookup. */
export const BAD_BEARER_LIMIT = { limit: 60, windowMs: 60 * 1000 }

/**
 * Seconds this address must wait after too many refused bearer tokens, or null. Only refusals count
 * (`countRefusedBearer`): a busy client with a good token never reaches the limit.
 */
export function refusedBearerWait(address: string): number | null {
	const peek = peekRateLimit(
		`bad-bearer:${address}`,
		BAD_BEARER_LIMIT.limit,
		BAD_BEARER_LIMIT.windowMs,
	)
	return peek.ok ? null : peek.retryAfterSeconds
}

export function countRefusedBearer(address: string) {
	rateLimit(`bad-bearer:${address}`, BAD_BEARER_LIMIT.limit, BAD_BEARER_LIMIT.windowMs)
}
