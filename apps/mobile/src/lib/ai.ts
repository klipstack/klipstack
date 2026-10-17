import type { AiAllowance, AiCitation } from "@klipstack/sdk"
import { KlipstackApiError } from "@klipstack/sdk"

/**
 * The reader's AI in the app: where the account stands against its monthly cap, and what to say
 * when a question is refused. As the web reader's (`use-ai-allowance.ts`, `ai-card.tsx`), in the
 * app's English.
 */

/** Why a question got no answer: an API error's code, or `network`. */
export type AiFailure = { code: string; details?: Record<string, unknown> }

export function failureOf(error: unknown): AiFailure {
	if (error instanceof KlipstackApiError)
		return { code: error.code, details: error.details ?? undefined }
	return { code: "network" }
}

/** A fifth of the cap or less left: the app says how many. */
export const FEW_LEFT = 0.2

/**
 * How many questions are left, and whether to say so: only when few are, or none. Once the month
 * it counts is over, the count no longer holds; the server's next answer says.
 */
export function questionsLeft(allowance: AiAllowance | null, now = Date.now()) {
	if (!allowance || now >= Date.parse(allowance.resetsAt))
		return { left: Infinity, few: false, none: false }
	const left = Math.max(0, allowance.max - allowance.used)
	return { left, few: left > 0 && left <= allowance.max * FEW_LEFT, none: left === 0 }
}

/** A refusal at the cap: none left, whatever the app thought. Other failures change nothing. */
export function afterFailure(
	allowance: AiAllowance | null,
	failure: AiFailure,
): AiAllowance | null {
	if (failure.code !== "limit_reached") return allowance
	const max = typeof failure.details?.max === "number" ? failure.details.max : allowance?.max
	const resetsAt =
		typeof failure.details?.resetsAt === "string" ? failure.details.resetsAt : allowance?.resetsAt
	return max === undefined || resetsAt === undefined ? allowance : { used: max, max, resetsAt }
}

/** The day the count starts over, as "November 1": midnight UTC on the 1st. */
export function resetsOn(resetsAt: string): string {
	return new Date(resetsAt).toLocaleDateString("en-US", {
		month: "long",
		day: "numeric",
		timeZone: "UTC",
	})
}

const limitMessage = (resetsAt: string | undefined) =>
	`You've asked as many questions as this month allows. It starts over on ${resetsAt ? resetsOn(resetsAt) : "the 1st"}.`

const FAILURES: Record<string, string> = {
	rate_limited: "Too many questions at once. Wait a few minutes and try again.",
	network: "Klipstack couldn't be reached. Check your connection and try again.",
	no_match: "That passage isn't in the article anymore.",
	ambiguous_quote: "That passage appears more than once. Select a little more of it.",
	not_ready: "The article is being updated. Try again in a moment.",
	forbidden: "AI answers aren't turned on for your account.",
	unavailable: "AI answers aren't set up on this server.",
	too_large: "This article is too long to ask about.",
	already_pending: "The last question is still being answered. Try again in a minute.",
}

/** What to say for a failure. */
export function failureMessage(failure: AiFailure, allowance: AiAllowance | null): string {
	if (failure.code === "limit_reached") {
		const at = failure.details?.resetsAt
		return limitMessage(typeof at === "string" ? at : allowance?.resetsAt)
	}
	return FAILURES[failure.code] ?? "Couldn't answer. Try again."
}

/** Under the next question: how many are left when few are, or why none can be asked. */
export function allowanceMessage(allowance: AiAllowance | null, now = Date.now()): string | null {
	const { left, few, none } = questionsLeft(allowance, now)
	if (none) return limitMessage(allowance?.resetsAt)
	if (!few) return null
	return `${left} ${left === 1 ? "question" : "questions"} left this month`
}

/** An answer as it is written: its text and citations so far. */
export type Written = { text: string; citations: AiCitation[] }

export const NOTHING_WRITTEN: Written = { text: "", citations: [] }

/** The answer or brief so far, with one more of its events. */
export function written(
	so: Written,
	event: { type: "text"; text: string } | { type: "citation"; citation: AiCitation },
): Written {
	return event.type === "text"
		? { text: so.text + event.text, citations: so.citations }
		: { text: so.text, citations: [...so.citations, event.citation] }
}

/**
 * What the app says before the first question, and in Account: what is sent, to whom, and when.
 * As the privacy policy's "Questions about what you read".
 */
export const AI_CONSENT = {
	title: "Ask Anthropic's AI?",
	sent: "To answer, Klipstack sends Anthropic the article's text, the passage you chose and your question. Anthropic uses them only to answer, and doesn't train its models on them.",
	when: "Nothing is sent until you ask. Your choice holds on all your devices, and you can change it in Account.",
} as const
