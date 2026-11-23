import { ExtractError, type ExtractedArticle } from "@klipstack/extract"
import { log } from "./log"
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
 * Pages parsed at once. One thread may grow to PARSE_HEAP_MB plus what jsdom keeps outside the
 * heap: the whole process peaked at 684 MB with the thread at its limit (measured), which leaves
 * room for sharp's two image decodes (up to 320 MB, apps/worker/src/images.ts) inside the
 * worker's 1200 MB (docs/self-hosting/compose.yml). Two threads at their limit came to 1150 MB.
 */
export const PARSE_THREADS = 1

/**
 * A parse that takes longer stops: the slowest article among the extraction fixtures parses in
 * about 3 s. Past this, the page is one that hangs the parser, and it would hang again on a
 * retry. Pages wait for the thread in turn, so this also bounds how long one page holds the
 * others up.
 */
export const PARSE_TIME_LIMIT_MS = 30_000

/** A thread's heap: a page that needs more fails alone, instead of taking the worker down. */
export const PARSE_HEAP_MB = 384

export const PARSE_THREAD_SCRIPT = new URL("./parse-thread.ts", import.meta.url)

export const reviveError = (fields: ErrorFields) =>
	fields.name === "ExtractError"
		? new ExtractError(fields.code as ExtractError["code"], fields.message, {
				status: typeof fields.status === "number" ? fields.status : undefined,
				retryAfter: typeof fields.retryAfter === "number" ? fields.retryAfter : null,
			})
		: Object.assign(new Error(fields.message), fields)

let pool: ThreadPool<ParseInput, ParseOutput> | undefined

function parsePool() {
	pool ??= createThreadPool<ParseInput, ParseOutput>({
		script: PARSE_THREAD_SCRIPT,
		size: PARSE_THREADS,
		timeoutMs: PARSE_TIME_LIMIT_MS,
		resourceLimits: { maxOldGenerationSizeMb: PARSE_HEAP_MB },
		onThreadError: (error) => log.warn("parse: a thread ended on an error", { error }),
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
/** What a thread's timeout or crash means for the page: it is too large to parse. */
export function asExtractError(error: unknown): unknown {
	if (error instanceof ThreadTimeoutError)
		return new ExtractError("too_large", `Parsing took longer than ${error.limitMs}ms`, {
			cause: error,
		})
	if (error instanceof ThreadCrashError)
		return new ExtractError("too_large", "Parsing ran out of memory or crashed", { cause: error })
	return error
}

export async function parseCapture(
	input: ParseInput,
	{ signal, timeoutMs }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ParseOutput> {
	try {
		return await parsePool().run(input, { signal, timeoutMs })
	} catch (error) {
		throw asExtractError(error)
	}
}

/** Stops the parse threads (shutdown, tests). */
export async function closeParsePool() {
	const closing = pool
	pool = undefined
	await closing?.close()
}
