import { somethingDifferent } from "@klipstack/api-contract/topics"
import type { Topic } from "@klipstack/sdk"

/**
 * Home's "About what?", as the web's (apps/web/app/routes/reading-home.tsx): the reader's topics
 * with something to read, the biggest as chips and the rest under More, and something different:
 * the topic read from least lately (`somethingDifferent`, the web's rule). Pure: the screen is
 * `app/(tabs)/(home)/index.tsx`.
 */

/** Topics shown as chips; the rest go under More. */
export const HOME_CHIPS = 4

/** A topic chosen on Home, and whether it was offered as something different. */
export type TopicPick = { id: string; different: boolean } | null

export interface HomeTopicChoice {
	chips: Topic[]
	more: Topic[]
	/** The topic to offer as something different; null with fewer than two to choose from. */
	different: string | null
	/** The topic Home narrows to, still one to read from; null for everything. */
	chosen: { topic: Topic; different: boolean } | null
}

/**
 * The choice, from `GET /topics`, with the reader's pick. Null without a topic to read from: no
 * choice to show. A pick that is no topic now, or has nothing left to read, is no choice. Something
 * different, once picked, stays the same topic after the reader reads from it.
 */
export function homeTopicChoice(topics: Topic[], pick: TopicPick): HomeTopicChoice | null {
	const list = topics
		.filter((t) => t.toRead > 0)
		.sort((a, b) => b.toRead - a.toRead || a.name.localeCompare(b.name))
	if (list.length === 0) return null
	const picked = pick ? list.find((t) => t.id === pick.id) : undefined
	const chips = list.slice(0, HOME_CHIPS)
	if (picked && !pick!.different && !chips.includes(picked)) chips.push(picked)
	return {
		chips,
		more: list.filter((t) => !chips.includes(t)),
		different: picked && pick!.different ? picked.id : somethingDifferent(list),
		chosen: picked ? { topic: picked, different: pick!.different } : null,
	}
}

/** The chosen topic above Home's sections: its name, why it is there, and the way to all of it. */
export function topicHeading({ topic, different }: { topic: Topic; different: boolean }): {
	title: string
	line: string
	all: string
} {
	return {
		title: topic.name,
		line: different
			? topic.lastReadAt
				? "Something different: the topic you haven't read from in the longest time."
				: "Something different: a topic you haven't read from yet."
			: `${topic.toRead} to read`,
		all: `Everything in ${topic.name}`,
	}
}
