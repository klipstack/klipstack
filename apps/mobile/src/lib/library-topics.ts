import { addOperator } from "@klipstack/api-contract/search-query"
import type { Topic } from "@klipstack/sdk"
import { t } from "./i18n"

/**
 * The library's topic choice, as the web's: a list (Inbox, Starred, Archive) narrowed to one of
 * the reader's automatic topics, or to those sorted into none. Pure: the screens are in
 * `components/library-list.tsx` and the search tab.
 */

/** `GET /topics?view=`: the reader's topics with what each holds of one list. */
export interface TopicsInList {
	items: Topic[]
	/** The list's articles sorted into no topic. */
	none: number
	/** The list's articles not sorted yet. */
	sorting: number
}

/** A topic's id, `none` for the articles in no topic, or null for every topic. */
export type TopicChoice = string | null

export const NO_TOPIC = t("library.topicChoice.none")

const NONE_DESCRIPTION = t("library.topicChoice.noneDescription")

function articles(n: number): string {
	if (n === 0) return t("library.topicChoice.noneHere")
	return t("library.articles", { count: n })
}

/** The menu's choices, in the server's order (most in the list first), the chosen one on. */
export function topicMenu(
	topics: TopicsInList,
	chosen: TopicChoice,
): { value: TopicChoice; label: string; count: string | null; on: boolean }[] {
	return [
		{ value: null, label: t("library.topicChoice.every"), count: null, on: chosen === null },
		...topics.items.map((t) => ({
			value: t.id,
			label: t.name,
			count: articles(t.inView ?? 0),
			on: chosen === t.id,
		})),
		{ value: "none", label: NO_TOPIC, count: articles(topics.none), on: chosen === "none" },
	]
}

/** What the chosen topic holds, for the line above the list. */
export function chosenTopic(
	topics: TopicsInList,
	chosen: TopicChoice,
): { name: string; description: string } | null {
	if (chosen === "none") {
		const sorting =
			topics.sorting === 0 ? "" : ` ${t("library.topicChoice.sorting", { count: topics.sorting })}`
		return { name: NO_TOPIC, description: NONE_DESCRIPTION + sorting }
	}
	const topic = topics.items.find((t) => t.id === chosen)
	return topic ? { name: topic.name, description: topic.description } : null
}

/** Whether a choice is still one of the reader's topics: one may end, or topics be turned off. */
export function topicStillThere(topics: TopicsInList, chosen: string): boolean {
	if (topics.items.length === 0) return false
	return chosen === "none" || topics.items.some((t) => t.id === chosen)
}

/**
 * The topic a list asks the server for: the chosen one once the reader's topics confirm it, so the
 * list never shows one topic without saying which. Undefined while they load: the list waits.
 * Every topic when they can't load (the menu is gone too), or the chosen one ended.
 */
export function topicToAsk(
	chosen: TopicChoice,
	topics: TopicsInList | "loading" | "failed",
): TopicChoice | undefined {
	if (chosen === null) return null
	if (topics === "loading") return undefined
	if (topics === "failed") return null
	return topicStillThere(topics, chosen) ? chosen : null
}

/** Whether a list's load is the copy kept for offline reading: Inbox or Starred, every topic. */
export function keptOffline(view: string, topic: TopicChoice): boolean {
	return (view === "inbox" || view === "starred") && topic === null
}

/**
 * Whether a failed load means the list's topic ended, or topics were turned off: the API answers
 * `not_found` for a topic that is none of the reader's now.
 */
export function topicEnded(topic: TopicChoice, error: unknown): boolean {
	return (
		topic !== null &&
		error instanceof Error &&
		(error as Error & { code?: unknown }).code === "not_found"
	)
}

/** The search for a topic's articles: `topic:` and its whole name. */
export function topicQuery(name: string): string {
	return addOperator("", "topic", name)
}

/** The empty search's hint; a reader with topics also gets has:topic, and their topics below it. */
export function searchHint(hasTopics: boolean): string {
	return hasTopics ? t("library.search.hintTopics") : t("library.search.hint")
}
