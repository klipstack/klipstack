import { and, count, db, documents, eq, isNull, sql } from "@klipstack/db"
import { homeShelves, TIME_FILTER_MIN } from "~/lib/home-shelves"
import { homeFeedItems } from "./feeds.server"
import { countUnfinished, homeCandidates } from "./reading-suggestions.server"
import { reviewSuggested } from "./review.server"

/**
 * Home: candidates for its sections (`homeShelves` picks from them, for any time choice), whether
 * to offer the time choice, new feed posts, and whether to suggest reviewing old saves. In a topic
 * (`topicId`, one of the reader's), only its articles: feed posts have no topics, and an empty
 * topic is not an empty library.
 */
export async function readingHome(
	userId: string,
	{ now = new Date(), topicId }: { now?: Date; topicId?: string } = {},
) {
	const [candidates, unfinished, feed, review] = await Promise.all([
		homeCandidates(userId, { now, topicId }),
		countUnfinished(userId),
		topicId ? [] : homeFeedItems(userId),
		reviewSuggested(userId, now),
	])
	const shelves = homeShelves(candidates, null)
	const emptyState =
		topicId ||
		shelves.reading.length ||
		shelves.recent.length ||
		shelves.again.length ||
		shelves.rediscover.length ||
		feed.length
			? null
			: await homeEmptyState(userId)
	return { candidates, timeChoice: unfinished > TIME_FILTER_MIN, feed, emptyState, review }
}

/** Only queried when there is nothing to feature. Archived and trashed saves are not pending work. */
async function homeEmptyState(userId: string) {
	const [state] = await db
		.select({
			saved: count(),
			library: sql<number>`count(*) filter (where ${documents.archivedAt} is null)::int`,
			pending: sql<number>`count(*) filter (where ${documents.archivedAt} is null and ${documents.status} in ('queued', 'processing'))::int`,
			failed: sql<number>`count(*) filter (where ${documents.archivedAt} is null and ${documents.status} = 'failed')::int`,
		})
		.from(documents)
		.where(and(eq(documents.userId, userId), isNull(documents.deletedAt)))
	if (state?.pending) return { kind: "processing", to: "/library" } as const
	if (state?.failed) return { kind: "failed", to: "/library" } as const
	if (state?.saved)
		return { kind: "caughtUp", to: state.library ? "/library" : "/archive" } as const
	return { kind: "new", to: "/home?save" } as const
}
