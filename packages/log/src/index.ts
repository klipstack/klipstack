/**
 * Errors for server logs (the web app, the worker, the packages they share): name, codes, an HTTP
 * status and stack frames, never the message. Messages quote user data: a failed query's message
 * lists its parameters (notes, captured pages, tokens), and fetch errors name the URLs saved.
 */

const NAME = /^[A-Za-z_$][\w$]{0,99}$/
const CODE = /^[\w.-]{1,40}$/
const MAX_FRAMES = 10
const MAX_FRAME_LENGTH = 300
/** A frame V8 wrote: "    at fn (location)" or "    at location", at a file, URL or Node internal. */
const FRAME = /^ {4}at (?:.{1,200} \()?(?:file:\/\/|node:|\/|[A-Za-z]:\\|<anonymous>|native)/

/** Reads a property that may be a getter that throws. */
function read<T>(get: () => T): T | undefined {
	try {
		return get()
	} catch {
		return undefined
	}
}

const label = (value: unknown) =>
	typeof value === "string" && NAME.test(value) ? value : undefined

/** better-auth's API errors keep their code in their body, as a constant in upper snake case. */
const BODY_CODE = /^[A-Z][A-Z0-9_]{0,59}$/

function codeOf(value: unknown): string | undefined {
	if (!value || typeof value !== "object") return undefined
	const code = read(() => (value as { code?: unknown }).code)
	if (typeof code === "string" || typeof code === "number")
		return CODE.test(String(code)) ? String(code) : undefined
	const bodyCode = read(() => (value as { body?: { code?: unknown } }).body?.code)
	return typeof bodyCode === "string" && BODY_CODE.test(bodyCode) ? bodyCode : undefined
}

/**
 * The frames after the stack's header, which is "<Name>: <message>" (or "<Name>" alone). When the
 * header does not match the current message exactly (it was changed, or is not a string), frames
 * cannot be told apart from message lines, so there are none. Frames end at the first line that
 * does not look like one.
 */
function stackFrames(error: Error): string[] {
	const stack = read(() => error.stack)
	const message = read(() => error.message)
	if (typeof stack !== "string" || typeof message !== "string") return []
	let rest: string
	if (message) {
		const sep = stack.indexOf(": ")
		if (sep < 0 || !NAME.test(stack.slice(0, sep))) return []
		if (!stack.startsWith(`${message}\n`, sep + 2)) return []
		rest = stack.slice(sep + 2 + message.length + 1)
	} else {
		// "Name" alone, or "Name: " (source-mapped stacks keep the separator).
		const newline = stack.indexOf("\n")
		if (newline < 0 || !NAME.test(stack.slice(0, newline).replace(/: $/, ""))) return []
		rest = stack.slice(newline + 1)
	}
	const frames: string[] = []
	for (const line of rest.split("\n")) {
		if (frames.length === MAX_FRAMES || !FRAME.test(line)) break
		frames.push(line.slice(0, MAX_FRAME_LENGTH))
	}
	return frames
}

const isHttpStatus = (value: unknown): value is number =>
	typeof value === "number" && Number.isInteger(value) && value >= 100 && value < 600

/** `status`, or `statusCode` (better-auth's API errors have a status name in `status`). */
function statusOf(value: unknown): number | undefined {
	if (!value || typeof value !== "object") return undefined
	const status = read(() => (value as { status?: unknown }).status)
	if (isHttpStatus(status)) return status
	const statusCode = read(() => (value as { statusCode?: unknown }).statusCode)
	return isHttpStatus(statusCode) ? statusCode : undefined
}

/**
 * The error as log lines: "Name code=… status=… cause=… cause.code=…", then its stack frames
 * (unless `frames` is false). Never throws.
 */
export function describeError(
	error: unknown,
	{ frames = true }: { frames?: boolean } = {},
): string {
	try {
		if (!(error instanceof Error)) return `non-Error thrown (${typeof error})`
		const cause = read(() => (error as Error & { cause?: unknown }).cause)
		const summary = [
			label(read(() => error.name)) ?? "Error",
			codeOf(error) && `code=${codeOf(error)}`,
			statusOf(error) && `status=${statusOf(error)}`,
			cause instanceof Error && `cause=${label(read(() => cause.name)) ?? "Error"}`,
			codeOf(cause) && `cause.code=${codeOf(cause)}`,
		]
			.filter(Boolean)
			.join(" ")
		return frames ? [summary, ...stackFrames(error)].join("\n") : summary
	} catch {
		return "unloggable error"
	}
}

/** One line for an error inside a log entry: its name and codes. */
export const errorLabel = (error: unknown) => describeError(error, { frames: false })

export function logError(context: string, error: unknown) {
	console.error(`${context}\n${describeError(error)}`)
}

/**
 * Log entry fields with every error value reduced to its label. The other values must already be
 * safe to log (ids, counts, codes, hosts): pass nothing a user typed or saved.
 */
export function safeFields(fields: unknown): unknown {
	if (fields instanceof Error) return { error: errorLabel(fields) }
	if (!fields || typeof fields !== "object" || Array.isArray(fields)) return fields
	return Object.fromEntries(
		Object.entries(fields).map(([key, value]) => [
			key,
			value instanceof Error ? errorLabel(value) : value,
		]),
	)
}

/** The host of a URL, for logs: paths and queries may identify private pages or carry tokens. */
export function loggedHost(url: string): string {
	try {
		return new URL(url).hostname
	} catch {
		return "(invalid url)"
	}
}

/** A URL for the request log: the path only. Query strings carry search terms, OAuth requests and saved URLs. */
export function loggedPath(url: string): string {
	const end = url.search(/[?#]/)
	return end < 0 ? url : url.slice(0, end)
}
