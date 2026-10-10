import { and, count, db, documents, eq, isNull, sql } from "@klipstack/db"
import { listDocuments } from "./documents.server"
import { homeFeedItems } from "./feeds.server"

/** Small selections from Library and new feed posts. Filtering precedes each query's limit. */
export async function readingHome(userId: string) {
	const base = { userId, view: "inbox" as const, readyOnly: true, limit: 3 }
	const [reading, latest, feed] = await Promise.all([
		listDocuments({ ...base, filter: "progress" }),
		listDocuments({ ...base, filter: "unread", sort: "newest", limit: 4 }),
		homeFeedItems(userId),
	])
	// With nothing in progress, the newest save takes the big card, above three more.
	const recent = reading.items.length ? latest.items.slice(0, 3) : latest.items
	const quick = await listDocuments({
		...base,
		filter: "quick",
		excludeIds: [...reading.items, ...recent].map((doc) => doc.id),
	})
	const emptyState =
		reading.items.length || recent.length || quick.items.length || feed.length
			? null
			: await homeEmptyState(userId)
	return { reading: reading.items, recent, quick: quick.items, feed, emptyState }
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
