import { TOPIC_USES } from "@klipstack/api-contract/enums"
import { parseSearchQuery } from "@klipstack/api-contract/search-query"
import type { TopicUseMetric } from "@klipstack/db/schema"

/**
 * What the reader clicks in topics, as `countTopicUse` (`/topics/use`) counts it: the command
 * takes these names and no others.
 */
export const TOPIC_CLICKS = TOPIC_USES satisfies readonly TopicUseMetric[]
export type TopicClick = (typeof TOPIC_CLICKS)[number]

/**
 * Counts a click for admins: a beacon, so it survives the navigation it starts and the page waits
 * for nothing. Its name only, no article and no topic. Without JavaScript nothing is counted.
 */
export function countTopicClick(use: TopicClick) {
	const body = new FormData()
	body.set("use", use)
	navigator.sendBeacon?.("/topics/use", body)
}

/** A query's topic filters (`topic:`, `has:topic`), as written, in order. */
function topicFilters(query: string): string {
	return parseSearchQuery(query)
		.tokens.filter(
			(token) =>
				token.kind === "operator" &&
				(token.key === "topic" || (token.key === "has" && token.value?.toLowerCase() === "topic")),
		)
		.map((token) => token.raw.toLowerCase())
		.join(" ")
}

/**
 * A search the reader runs counts as filtered by topic when it names a topic, or no topic, that
 * the search shown (`previous`) did not: the same query sent again, or other words, count nothing.
 */
export function countTopicSearch(query: string, previous: string) {
	const filters = topicFilters(query)
	if (filters && filters !== topicFilters(previous)) countTopicClick("topic_filter_search")
}
