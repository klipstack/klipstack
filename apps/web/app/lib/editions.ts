/**
 * Edition rules the editor and the server share, so both agree. Framework-free. The server enforces
 * the quote cap on every item save and again at publish.
 */
import { slugify } from "@klipstack/api-contract/names"

export const EDITION_TITLE_MAX = 200
export const EDITION_INTRO_MAX = 5_000

/** Most highlights one item may quote. */
export const QUOTES_MAX = 3
/** Most words one item may quote, however long the article. */
export const QUOTE_WORDS_MAX = 150

/** Words in a quote, split on whitespace. */
export function countWords(text: string): number {
	return text.split(/\s+/).filter(Boolean).length
}

/** Most words an item may quote: a tenth of the article, at most 150. 150 for an unknown length. */
export function quoteWordLimit(wordCount: number | null): number {
	if (wordCount === null) return QUOTE_WORDS_MAX
	return Math.min(QUOTE_WORDS_MAX, Math.floor(wordCount / 10))
}

/** What an item's included quotes take of its cap, for the editor's "92 / 150 words quoted". */
export type QuoteUsage = { quotes: number; words: number; wordLimit: number }

export function quoteUsage(quotes: readonly string[], wordCount: number | null): QuoteUsage {
	const words = quotes.reduce((sum, quote) => sum + countWords(quote), 0)
	return { quotes: quotes.length, words, wordLimit: quoteWordLimit(wordCount) }
}

export type QuoteProblem = "too-many" | "too-long"

/**
 * Why an item's included quotes break the cap, or null when they fit. Quotes are never cut, so a
 * highlight longer than what is left cannot be included. Notes don't count: they are the user's.
 * To know whether ticking a highlight is allowed, pass the included quotes plus that one.
 */
export function quoteProblem(
	quotes: readonly string[],
	wordCount: number | null,
): QuoteProblem | null {
	const usage = quoteUsage(quotes, wordCount)
	if (usage.quotes > QUOTES_MAX) return "too-many"
	if (usage.words > usage.wordLimit) return "too-long"
	return null
}

const SLUG_MAX = 60

/**
 * The readable part of a public URL (`/e/:publicId/:slug`). It follows the published title, else
 * the day of the first publish; the public id alone finds the edition. Long titles are cut at a
 * word.
 */
export function editionSlug(title: string | null, publishedAt: Date, timeZone: string): string {
	if (!title) return dayIn(publishedAt, timeZone)
	const slug = slugify(title)
	if (slug.length <= SLUG_MAX) return slug
	const end = slug.lastIndexOf("-", SLUG_MAX)
	return end > 0 ? slug.slice(0, end) : slug.slice(0, SLUG_MAX)
}

/** An item's included quotes, as `quoteProblem` takes them. */
export function includedQuotes(
	highlights: readonly { exact: string; included: boolean }[],
): string[] {
	return highlights.filter((h) => h.included).map((h) => h.exact)
}

/** Whether a public page may link to it or load it: http and https only. */
export function isHttpUrl(url: string | null | undefined): url is string {
	if (!url) return false
	try {
		const { protocol } = new URL(url)
		return protocol === "http:" || protocol === "https:"
	} catch {
		return false
	}
}

/** A URL as a Markdown link target. A parenthesis would end the link early. */
export function markdownUrl(url: string): string {
	return url.replaceAll("(", "%28").replaceAll(")", "%29")
}

/** The day of `date` in a time zone, as `YYYY-MM-DD`. */
export function dayIn(date: Date, timeZone: string): string {
	// Canadian English writes dates as ISO does.
	return new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(date)
}

/**
 * An edition's date as its page says it, "October 1, 2026", in its language and time zone. It is
 * the first publish; a draft's is today. Format it on the server: Node and browsers differ.
 */
export function formatEditionDate(date: Date, locale: string, timeZone: string): string {
	return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone }).format(date)
}

/** What a published edition is called where its page is named: its title, else its date. */
export function editionTitle(
	title: string | null,
	edition: { publishedAt: Date; locale: string; timeZone: string },
): string {
	return title ?? formatEditionDate(edition.publishedAt, edition.locale, edition.timeZone)
}

/**
 * When the sidebar nudges for a new edition: enough marked, or a while since the last edition with
 * something to share. Time alone never does: two weeks of nothing is no reason for an edition. Nor
 * does anything before a first edition, short of the marks: every account has editions, and most
 * readers may never publish one. With a draft started, never for another: for publishing that one,
 * a week after it was started.
 */
export const NUDGE = {
	/** Marked articles that are an edition by themselves. */
	marked: 3,
	/** Days after the last edition from which less will do. */
	staleDays: 14,
	/** Articles finished since the last edition that are something to share, without marks. */
	read: 5,
	/** Days after a draft was started from which it is due, with something in it. */
	draftDays: 7,
	/** How long "Not now" lasts. */
	snoozeDays: 7,
} as const

export interface EditionSignals {
	/** Articles marked for the next edition. */
	marked: number
	/** Whole days since the last edition was first published; null before the first. */
	daysSince: number | null
	/** Articles finished since the last edition. */
	readSince: number
	/** The draft in progress (`currentDraft`): whole days since it was started, and its articles. */
	draft: { days: number; items: number } | null
}

/**
 * Why an edition is due: enough marked, or a while since the last one, for a new one; a draft a
 * week old, for publishing it. Null when none is.
 */
export type NudgeReason = "marked" | "stale" | "draft"

export function nudgeReason(signals: EditionSignals): NudgeReason | null {
	if (signals.draft)
		return signals.draft.days >= NUDGE.draftDays && signals.draft.items > 0 ? "draft" : null
	if (signals.marked >= NUDGE.marked) return "marked"
	const something = signals.marked > 0 || signals.readSince >= NUDGE.read
	if (signals.daysSince !== null && signals.daysSince >= NUDGE.staleDays && something)
		return "stale"
	return null
}

/** Derived from the dates: a draft until published, then live until unpublished. */
export type EditionState = "draft" | "live" | "unpublished"

export function editionState(edition: {
	publishedAt: Date | null
	unpublishedAt: Date | null
}): EditionState {
	if (!edition.publishedAt) return "draft"
	return edition.unpublishedAt ? "unpublished" : "live"
}

/** Whether the working copy changed after the public page was last written. */
export function hasUnpublishedChanges(edition: {
	publishedAt: Date | null
	republishedAt: Date | null
	updatedAt: Date
}): boolean {
	const written = edition.republishedAt ?? edition.publishedAt
	return written !== null && edition.updatedAt > written
}

export type PublishProblem =
	| { code: "no_items" }
	| { code: "url"; itemId: string }
	| { code: "quotes"; itemId: string; problem: QuoteProblem }

/**
 * What stops the working copy from going public. Empty when nothing does. Items set aside don't
 * go public, so nothing about them does.
 */
export function publishProblems(
	items: readonly {
		id: string
		url: string
		wordCount: number | null
		included: boolean
		highlights: readonly { exact: string; included: boolean }[]
	}[],
): PublishProblem[] {
	const problems: PublishProblem[] = []
	const going = items.filter((item) => item.included)
	if (going.length === 0) problems.push({ code: "no_items" })
	for (const item of going) {
		if (!isHttpUrl(item.url)) problems.push({ code: "url", itemId: item.id })
		const problem = quoteProblem(includedQuotes(item.highlights), item.wordCount)
		if (problem) problems.push({ code: "quotes", itemId: item.id, problem })
	}
	return problems
}
