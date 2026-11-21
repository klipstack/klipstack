import { ExtractError, type ExtractedArticle } from "@klipstack/extract"
import {
	createThreadPool,
	type ErrorFields,
	ThreadCrashError,
	type ThreadPool,
	ThreadTimeoutError,
} from "./thread-pool"

export interface ParseInput {
	/** The capture: a page's HTML, or the X API's JSON. */
	body: string
	servedHtml: string | null
	url: string
	contentType: string | null
}

export interface ParseOutput {
	article: ExtractedArticle
	used: "rendered" | "served"
}

/**
 * Extraction jobs that run at once (`localConcurrency` in main.ts), and so parse threads. Each
 * thread may grow to PARSE_HEAP_MB, beside sharp's image decodes (apps/worker/src/images.ts): two
 * fit the worker's 1200 MB (docs/self-hosting/compose.yml).
 */
export const EXTRACT_CONCURRENCY = 2

/**
 * A parse that takes longer stops: a 5 MB page (fetch.ts's limit) parses in a few seconds. Past
 * this, the page is one that hangs the parser, and it would hang again on a retry.
 */
export const PARSE_TIME_LIMIT_MS = 30_000

/** A thread's heap: a page that needs more fails alone, instead of taking the worker down. */
export const PARSE_HEAP_MB = 384

const reviveError = (fields: ErrorFields) =>
	fields.name === "ExtractError"
		? new ExtractError(fields.code as ExtractError["code"], fields.message, {
				status: typeof fields.status === "number" ? fields.status : undefined,
				retryAfter: typeof fields.retryAfter === "number" ? fields.retryAfter : null,
			})
		: Object.assign(new Error(fields.message), fields)

let pool: ThreadPool<ParseInput, ParseOutput> | undefined

function parsePool() {
	pool ??= createThreadPool<ParseInput, ParseOutput>({
		script: new URL("./parse-thread.ts", import.meta.url),
		size: EXTRACT_CONCURRENCY,
		timeoutMs: PARSE_TIME_LIMIT_MS,
		resourceLimits: { maxOldGenerationSizeMb: PARSE_HEAP_MB },
		reviveError,
	})
	return pool
}

/**
 * Parses a capture on a parse thread. A page that runs past the time limit or out of memory is
 * `too_large`, a permanent failure (the reader sees "The page is too large"): parsing the same
 * capture again would end the same way. When `signal` aborts (the job's own limit), the parse
 * stops and the promise rejects with its reason.
 */
export async function parseCapture(
	input: ParseInput,
	{ signal, timeoutMs }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ParseOutput> {
	try {
		return await parsePool().run(input, { signal, timeoutMs })
	} catch (error) {
		if (error instanceof ThreadTimeoutError)
			throw new ExtractError("too_large", `Parsing took longer than ${error.limitMs}ms`, {
				cause: error,
			})
		if (error instanceof ThreadCrashError)
			throw new ExtractError("too_large", "Parsing ran out of memory or crashed", { cause: error })
		throw error
	}
}

/** Stops the parse threads (shutdown, tests). */
export async function closeParsePool() {
	const closing = pool
	pool = undefined
	await closing?.close()
}
