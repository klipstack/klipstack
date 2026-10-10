import {
	and,
	db,
	desc,
	documents,
	eq,
	isNotNull,
	isNull,
	lt,
	lte,
	not,
	notInArray,
	sql,
} from "@klipstack/db"
import { REDISCOVER_AFTER_DAYS } from "~/lib/inbox-filters"
import {
	finished,
	INBOX_FILTER_WHERE,
	type LibraryCard,
	libraryCardColumns,
} from "./documents.server"

/** Minutes left, as the cards count them (`HomeArticle`): at least one. */
const minutesLeft = sql<number>`greatest(1, ceil(${documents.readingMinutes} * (1 - ${documents.readingProgress})))`

/** Ready articles in the library, without those already shown elsewhere on the page. */
function suggestable(userId: string, excludeIds: string[]) {
	return and(
		eq(documents.userId, userId),
		isNull(documents.deletedAt),
		isNull(documents.archivedAt),
		eq(documents.status, "ready"),
		excludeIds.length ? notInArray(documents.id, excludeIds) : undefined,
	)
}

/**
 * Unread saves from a while ago, so older ones come back instead of sinking under newer ones. The
 * pick changes each day (UTC) and holds through the day: reloading Home doesn't shuffle it.
 */
export async function rediscoverDocuments({
	userId,
	limit,
	excludeIds = [],
	now = new Date(),
}: {
	userId: string
	limit: number
	excludeIds?: string[]
	now?: Date
}): Promise<LibraryCard[]> {
	const day = now.toISOString().slice(0, 10)
	const savedBefore = new Date(now.getTime() - REDISCOVER_AFTER_DAYS * 86_400_000)
	return db
		.select(libraryCardColumns)
		.from(documents)
		.where(
			and(
				suggestable(userId, excludeIds),
				INBOX_FILTER_WHERE.unread,
				lt(documents.createdAt, savedBefore),
			),
		)
		.orderBy(sql`md5(${documents.id}::text || ${day})`, documents.id)
		.limit(limit)
}

/**
 * Unfinished articles whose time left fits in `minutes`, the closest fit first: the time goes to
 * an article that fills it, not to the shortest ones. Articles only, as quick reads: posts are a
 * glance.
 */
export async function documentsThatFit({
	userId,
	minutes,
	limit,
	excludeIds = [],
}: {
	userId: string
	minutes: number
	limit: number
	excludeIds?: string[]
}): Promise<LibraryCard[]> {
	return db
		.select(libraryCardColumns)
		.from(documents)
		.where(
			and(
				suggestable(userId, excludeIds),
				eq(documents.type, "article"),
				isNotNull(documents.readingMinutes),
				not(finished),
				lte(minutesLeft, minutes),
			),
		)
		.orderBy(desc(minutesLeft), desc(documents.createdAt), desc(documents.id))
		.limit(limit)
}
