import { ExtractError } from "@klipstack/extract"
import { describeError, safeFields } from "@klipstack/log"

/**
 * Worker log lines. Fields must be safe to log (ids, counts, codes, hosts); errors among them are
 * reduced to their name and codes, since their messages can quote page text, URLs or query
 * parameters. Unexpected errors (anything but an ExtractError, whose code says what went wrong)
 * also get their stack frames, on the lines after.
 */
const write = (level: "log" | "warn" | "error") => (msg: string, fields?: unknown) => {
	const stacks = errorsIn(fields)
		.filter((error) => !(error instanceof ExtractError))
		.map((error) => `\n${describeError(error)}`)
	console[level](`[worker] ${msg}`, fields === undefined ? "" : safeFields(fields), ...stacks)
}

function errorsIn(fields: unknown): Error[] {
	if (fields instanceof Error) return [fields]
	if (!fields || typeof fields !== "object") return []
	return Object.values(fields).filter((value) => value instanceof Error)
}

export const log = {
	info: write("log"),
	warn: write("warn"),
	error: write("error"),
}
