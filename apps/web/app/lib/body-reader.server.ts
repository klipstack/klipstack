/**
 * The one reader of request bodies: `boundedRequest` (forms, sign-in, MCP) and the HTTP API's
 * `readJsonBody` both wrap it. It bounds bytes and time and never cancels the stream (that would
 * destroy the socket before the answer can go out). What a refusal looks like is the wrapper's job.
 */

export interface BodyTimeouts {
	/** No bytes for this long: the upload is abandoned. */
	idleMs: number
	/** The whole body must arrive within this. */
	totalMs: number
}

/** `large_refused`: `onLarge` threw (no upload slot); the error is the `cause`. */
export type BodyRefusalReason = "too_large" | "too_slow" | "unreadable" | "large_refused"

export class BodyRefusal extends Error {
	constructor(
		readonly reason: BodyRefusalReason,
		/** True when body is left unread: the answer must close the connection. */
		readonly unread: boolean,
		cause?: unknown,
	) {
		super(reason, { cause })
	}
}

type Chunk = { done: true; value?: undefined } | { done: false; value: Uint8Array }

/** The next chunk, or "timeout" when none comes in time. */
async function nextChunk(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	deadline: number,
	idleMs: number,
): Promise<Chunk | "timeout"> {
	const wait = Math.min(idleMs, deadline - Date.now())
	if (wait <= 0) return "timeout"
	let timer: ReturnType<typeof setTimeout> | undefined
	const timeout = new Promise<"timeout">((resolve) => {
		timer = setTimeout(() => resolve("timeout"), wait)
	})
	try {
		return (await Promise.race([reader.read(), timeout])) as Chunk | "timeout"
	} catch {
		// The client went away mid-upload.
		throw new BodyRefusal("unreadable", true)
	} finally {
		clearTimeout(timer)
	}
}

/**
 * Reads what is left of a body and throws it away, up to `budget` more bytes and within the
 * timeouts. True when the body was read to its end; otherwise the answer must close the
 * connection. Releases the reader.
 */
async function drain(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	budget: number,
	timeouts: BodyTimeouts,
): Promise<boolean> {
	const deadline = Date.now() + timeouts.totalMs
	let size = 0
	try {
		for (;;) {
			const chunk = await nextChunk(reader, deadline, timeouts.idleMs)
			if (chunk === "timeout") return false
			if (chunk.done) return true
			size += chunk.value.byteLength
			if (size > budget) return false
		}
	} catch {
		return false
	} finally {
		reader.releaseLock()
	}
}

/**
 * Throws away a body nobody read. True when there was nothing left to read, or it was read to its
 * end; false when the connection should close (declared over the limit, too large, too slow).
 */
export async function discardBody(
	request: Request,
	limit: number,
	timeouts: BodyTimeouts,
): Promise<boolean> {
	if (!request.body) return true
	if (request.body.locked) return false
	if (request.bodyUsed) return true
	const declared = Number(request.headers.get("content-length") ?? Number.NaN)
	if (declared > limit) return false
	return drain(request.body.getReader(), limit, timeouts)
}

/** A refusal for a body over its limit; `reader` is set when the stream is already open. */
async function tooLarge(
	body: ReadableStream<Uint8Array> | null,
	reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
	overflow: number,
): Promise<BodyRefusal> {
	// A small, bounded discard lets a client finish an ordinary oversized form and read the 413.
	// Never drain an unlimited attack body.
	if (overflow > 0 && body) {
		const drained = await drain(reader ?? body.getReader(), overflow, {
			idleMs: 1000,
			totalMs: 1000,
		})
		return new BodyRefusal("too_large", !drained)
	}
	return new BodyRefusal("too_large", true)
}

export interface ReadOptions {
	timeouts: BodyTimeouts
	/** Runs once the body is known to exceed `largeAt` (declared, or while reading). */
	largeAt?: number
	/** May throw to refuse the body: the rest is thrown away, then it is a `large_refused`. */
	onLarge?: () => void
	/** What was read so far, also when this throws. */
	progress?: { bytes: number }
	/** Bytes of a body over its limit to throw away before answering (default: none). */
	overflow?: number
}

/**
 * A body's bytes, within `limit` and the timeouts; `undefined` when there is none. `Content-Length`
 * is checked first, then the stream. Throws a `BodyRefusal`.
 */
export async function readBody(
	request: Request,
	limit: number,
	{
		timeouts,
		largeAt = Number.POSITIVE_INFINITY,
		onLarge,
		progress = { bytes: 0 },
		overflow = 0,
	}: ReadOptions,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
	const declared = Number(request.headers.get("content-length") ?? Number.NaN)
	if (declared > limit) throw await tooLarge(request.body, undefined, overflow)
	if (!request.body) return undefined
	const reader = request.body.getReader()
	let large = false
	const becameLarge = async () => {
		large = true
		try {
			onLarge?.()
		} catch (error) {
			const drained = await drain(reader, limit - progress.bytes, timeouts)
			throw new BodyRefusal("large_refused", !drained, error)
		}
	}
	if (declared > largeAt) await becameLarge()
	const deadline = Date.now() + timeouts.totalMs
	const chunks: Uint8Array[] = []
	for (;;) {
		const chunk = await nextChunk(reader, deadline, timeouts.idleMs)
		if (chunk === "timeout") throw new BodyRefusal("too_slow", true)
		if (chunk.done) break
		progress.bytes += chunk.value.byteLength
		if (progress.bytes > limit) throw await tooLarge(request.body, reader, overflow)
		chunks.push(chunk.value)
		if (!large && progress.bytes > largeAt) await becameLarge()
	}
	// Read to its end: nothing is left for the answer to wait on.
	reader.releaseLock()
	if (progress.bytes === 0) return undefined
	const bytes = new Uint8Array(progress.bytes)
	let at = 0
	for (const chunk of chunks) {
		bytes.set(chunk, at)
		at += chunk.byteLength
	}
	return bytes
}
