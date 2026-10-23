import type { FinishedLately, NextEdition } from "@klipstack/sdk"
import { dateLocale, t } from "./i18n"

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
			before: t("home.masthead.finished", { count: finished.count }),
			title: null,
			after: "",
		}
	if (!finished.title)
		return { before: t("home.masthead.finishedUntitled"), title: null, after: "" }
	return {
		before: t("home.masthead.finishedBefore"),
		title: shortTitle(finished.title, FINISHED_TITLE_MAX),
		after: t("home.masthead.finishedAfter"),
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
			count: items ? t("home.masthead.draft", { count: items }) : t("home.masthead.draftEmpty"),
			action: t("home.masthead.continueEditing"),
		}
	}
	if (next.marked < 1) return null
	return {
		count: t("home.masthead.marked", { count: next.marked }),
		action: t("home.masthead.putTogether"),
	}
}

/** Why an edition is due, as the web's Editions page says it; null when none is. */
export function editionNudge(next: NextEdition): string | null {
	const { nudge } = next
	if (!nudge) return null
	if (nudge.reason === "draft")
		return t("home.masthead.nudge.draft", { ago: ago(next.draft?.days ?? 0) })
	const last =
		nudge.daysSince === null ? null : t("home.masthead.nudge.last", { ago: ago(nudge.daysSince) })
	const why =
		next.marked > 0
			? t("home.masthead.nudge.marked", { count: next.marked })
			: t("home.masthead.nudge.read", { count: nudge.readSince })
	return last ? `${last} ${why}` : why
}

/** "today", "yesterday", "5 days ago", "3 weeks ago" from two weeks on: the web's `ago`. */
function ago(days: number): string {
	if (days >= 14) return t("home.masthead.ago.weeks", { count: Math.floor(days / 7) })
	if (days === 0) return t("home.masthead.ago.today")
	if (days === 1) return t("home.masthead.ago.yesterday")
	return t("home.masthead.ago.days", { count: days })
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

/** The date as a newspaper prints it: "Saturday, October 17, 2026", in the app's language. */
export function mastheadDate(now: Date, timeZone?: string): string {
	return new Intl.DateTimeFormat(dateLocale, { dateStyle: "full", timeZone }).format(now)
}

/**
 * The masthead's greeting, around the reader's first name, which Home marks as the web does:
 * "Good morning, " and "Ernesto". Without a name, the greeting alone.
 */
export function greeting(part: PartOfDay, name: string | null | undefined) {
	const first = name?.trim().split(/\s+/)[0] || null
	const words = t(`home.masthead.greeting.${part}`)
	return first ? { before: `${words}, `, name: first } : { before: words, name: null }
}
