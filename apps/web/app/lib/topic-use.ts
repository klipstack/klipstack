import { parseSearchQuery } from "@klipstack/api-contract/search-query"

/** What the reader clicked in topics, as `countTopicUse` (`/topics/use`) counts it. */
export type TopicClick =
	| "topic_filter_library"
	| "topic_filter_search"
	| "topic_opened"
	| "topic_next"
	| "topic_home"

/**
 * Counts a click for admins: a beacon, so it survives the navigation it starts and the page waits
 * for nothing. Its name only, no article and no topic. Without JavaScript nothing is counted.
 */
export function countTopicClick(use: TopicClick) {
	const body = new FormData()
	body.set("use", use)
	navigator.sendBeacon?.("/topics/use", body)
}

/** A search the reader runs counts as filtered by topic when it names one, or no topic. */
export function countTopicSearch(query: string) {
	const byTopic = parseSearchQuery(query).tokens.some(
		(token) =>
			token.kind === "operator" &&
			(token.key === "topic" || (token.key === "has" && token.value?.toLowerCase() === "topic")),
	)
	if (byTopic) countTopicClick("topic_filter_search")
}
