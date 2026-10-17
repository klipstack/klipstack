import type { FinishedLately, NextEdition } from "@klipstack/sdk"

/**
 * What Home says above its sections, as the web's masthead does
 * (apps/web/app/components/home-masthead.tsx, home-finished.tsx): what was finished this past
 * week, and the next edition in its corner.
 */

/** Titles longer than this are cut, so the sentence stays one line or two: the web's limit. */
const FINISHED_TITLE_MAX = 80

/**
 * "You finished N articles this past week.", around the title when there is one, which Home sets
 * apart. Only what was read: nothing after a week without a finish.
 */
export function finishedLine(
	finished: FinishedLately,
): { before: string; title: string | null; after: string } | null {
	if (finished.count < 1) return null
	if (finished.count > 1)
		return {
			before: `You finished ${finished.count} articles this past week.`,
			title: null,
			after: "",
		}
	if (!finished.title)
		return { before: "You finished an article this past week.", title: null, after: "" }
	return {
		before: "You finished ",
		title: shortTitle(finished.title, FINISHED_TITLE_MAX),
		after: " this past week.",
	}
}

/**
 * The next edition, as the web's ear says it: the draft in progress, else the articles marked.
 * Nothing marked and no draft: Home says nothing of editions to a reader who may not make them.
 */
export function editionEar(next: NextEdition): { count: string; action: string } | null {
	if (next.draft) {
		const { items } = next.draft
		return {
			count: items
				? `${items} ${items === 1 ? "article" : "articles"} in the draft`
				: "a draft started",
			action: "Continue editing",
		}
	}
	if (next.marked < 1) return null
	return { count: `${next.marked} marked`, action: "Put it together" }
}

/** Why an edition is due, as the web's Editions page says it; null when none is. */
export function editionNudge(next: NextEdition): string | null {
	const { nudge } = next
	if (!nudge) return null
	if (nudge.reason === "draft")
		return `You started it ${ago(next.draft?.days ?? 0)}. Ready to publish it?`
	const last =
		nudge.daysSince === null ? null : `Your last edition came out ${ago(nudge.daysSince)}.`
	const why =
		next.marked > 0
			? next.marked === 1
				? "1 article is marked for the next one."
				: `${next.marked} articles are marked for the next one.`
			: `You finished ${nudge.readSince} ${nudge.readSince === 1 ? "article" : "articles"} since.`
	return last ? `${last} ${why}` : why
}

/** "today", "yesterday", "5 days ago", "3 weeks ago" from two weeks on: the web's `ago`. */
function ago(days: number): string {
	if (days >= 14) return `${Math.floor(days / 7)} weeks ago`
	if (days === 0) return "today"
	if (days === 1) return "yesterday"
	return `${days} days ago`
}

/** A title for a sentence: at most `max` characters, cut after a word and ended with "…". */
function shortTitle(title: string, max: number): string {
	// By code points: an emoji or a rarer character is never cut in half.
	const chars = Array.from(title)
	if (chars.length <= max) return title
	const cut = chars.slice(0, max - 1).join("")
	const space = cut.lastIndexOf(" ")
	return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

export type PartOfDay = "morning" | "afternoon" | "evening"

/**
 * The part of the day in a time zone, as the web's masthead greets: morning from 5, afternoon from
 * 12, evening from 19 and on through the night (a reader up at 2 is still in their evening).
 */
export function partOfDay(now: Date, timeZone?: string): PartOfDay {
	const hour = Number(
		new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(now),
	)
	if (hour >= 5 && hour < 12) return "morning"
	if (hour >= 12 && hour < 19) return "afternoon"
	return "evening"
}

/** The date as a newspaper prints it: "Saturday, October 17, 2026". */
export function mastheadDate(now: Date, timeZone?: string): string {
	return new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone }).format(now)
}

/**
 * The masthead's greeting, around the reader's first name, which Home marks as the web does:
 * "Good morning, " and "Ernesto". Without a name, the greeting alone.
 */
export function greeting(part: PartOfDay, name: string | null | undefined) {
	const first = name?.trim().split(/\s+/)[0] || null
	const words = `Good ${part}`
	return first ? { before: `${words}, `, name: first } : { before: words, name: null }
}
