import { and, count, db, documents, eq, isNull, sql } from "@klipstack/db"
import { homeShelves, TIME_FILTER_MIN } from "~/lib/home-shelves"
import { homeFeedItems } from "./feeds.server"
import { countUnfinished, homeCandidates } from "./reading-suggestions.server"

/**
 * Home: candidates for its sections (`homeShelves` picks from them, for any time choice), whether
 * to offer the time choice, and new feed posts.
 */
export async function readingHome(userId: string, { now = new Date() }: { now?: Date } = {}) {
	const [candidates, unfinished, feed] = await Promise.all([
		homeCandidates(userId, { now }),
		countUnfinished(userId),
		homeFeedItems(userId),
	])
	const shelves = homeShelves(candidates, null)
	const emptyState =
		shelves.reading.length || shelves.recent.length || shelves.rediscover.length || feed.length
			? null
			: await homeEmptyState(userId)
	return { candidates, timeChoice: unfinished > TIME_FILTER_MIN, feed, emptyState }
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
	return { kind: "new", to: "/add" } as const
}
