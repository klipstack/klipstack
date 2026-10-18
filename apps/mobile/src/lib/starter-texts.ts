import type { StarterLanguage, StarterText, StarterTopic } from "@klipstack/sdk"
import { lostConnection } from "./offline"
import { bookColor, hash } from "./topic-shelves"

/**
 * The starter texts' pure parts, as the web draws them (apps/web/app/components/starter-texts.tsx):
 * the guide to Klipstack and short texts to try it on, as books on shelves by topic. The screens
 * are `app/discover.tsx` and Home's empty state (`components/starter-texts.tsx`).
 */

/** `GET /starter-texts`. */
export type StarterShelves = {
	language: StarterLanguage
	readerLanguage: StarterLanguage
	guide: StarterText
	guideFirst: boolean
	shelves: { topic: StarterTopic; items: StarterText[] }[]
}

/** `GET /starter-texts/offer`. */
export type StarterOffer = { guide: StarterText | null; texts: StarterText[] }

/** The shelves' names, as the web's English ones: the app's own words are English. */
export const TOPIC_NAMES: Record<StarterTopic, { title: string; description: string }> = {
	reading: { title: "Reading & writing", description: "Writers on books, style and readers." },
	stories: { title: "Stories", description: "Short fiction to read in one sitting." },
	living: { title: "How to live", description: "Advice on time, work and character." },
	ideas: {
		title: "Ideas & work",
		description: "Essays on making things, technology and thinking for yourself.",
	},
	science: {
		title: "Science & nature",
		description: "Scientists and naturalists explaining the world.",
	},
	society: {
		title: "Society & history",
		description: "Speeches and essays that argued for change.",
	},
}

/** Each language by its own name: a reader looks for the one they read. */
export const LANGUAGE_NAMES: Record<StarterLanguage, string> = { en: "English", es: "Español" }

/** What the shelves say about themselves, as the web's. */
export const STARTER_DESCRIPTION =
	"Essays, stories and speeches to try highlights and notes on. A book marked with a site is saved from the site that publishes it. Choose a book to add it to your library."

/**
 * A book's paint and how much taller than the shelf's shortest it stands, by its name, as the
 * web's: it keeps both from one visit to the next.
 */
export function starterBook(
	slug: string,
	scheme: "light" | "dark",
): { color: string; taller: number } {
	const h = hash(slug)
	return { color: bookColor((h % 12) * 30, scheme), taller: h % 14 }
}

/**
 * The shelves to show offline, from those kept per language (`kept`): the language asked for, or,
 * with none asked, the ones kept in the reader's own language.
 */
export function keptShelves(
	asked: StarterLanguage | null,
	kept: (language: StarterLanguage) => StarterShelves | null,
): StarterShelves | null {
	if (asked) return kept(asked)
	return (
		(["en", "es"] as const)
			.map(kept)
			.find((shelves) => shelves && shelves.language === shelves.readerLanguage) ?? null
	)
}

/** What VoiceOver says a book does when tapped. */
export function starterLabel(item: StarterText): string {
	if (item.articleId) return `Open ${item.title}`
	return item.site
		? `Add ${item.title} to your library from ${item.site}`
		: `Add ${item.title} to your library`
}

/** Why a text could not be added, in the reader's words. */
export function starterRefusal(error: unknown): string {
	if (lostConnection(error)) return "Can't reach Klipstack. Connect to the internet to add it."
	return error instanceof Error ? error.message : String(error)
}
