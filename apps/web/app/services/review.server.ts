import {
	and,
	db,
	documents,
	eq,
	highlights,
	isNull,
	lt,
	not,
	notExists,
	or,
	type SQL,
	sql,
	user as userTable,
} from "@klipstack/db"
import { REVIEW } from "~/lib/review"
import {
	finished,
	INBOX_FILTER_WHERE,
	type LibraryCard,
	libraryCardColumns,
	readBefore,
} from "./documents.server"

const DAY_MS = 86_400_000

/**
 * The user's old saves never touched: in the library, saved more than `REVIEW.afterDays` ago,
 * never opened or finished, and nothing of the reader's on them (a star, a mark for the next
 * edition, a note, a note for an edition, highlights). Tags don't count: they are mostly given when
 * saving. Kept in the last `REVIEW.keepDays`, they are left alone.
 */
export function reviewWhere(userId: string, now: Date): SQL {
	const savedBefore = new Date(now.getTime() - REVIEW.afterDays * DAY_MS)
	const keptBefore = new Date(now.getTime() - REVIEW.keepDays * DAY_MS)
	return and(
		eq(documents.userId, userId),
		isNull(documents.deletedAt),
		isNull(documents.archivedAt),
		eq(documents.status, "ready"),
		INBOX_FILTER_WHERE.unread,
		not(finished),
		// Put back to be read again: wanted, whenever that was.
		not(readBefore),
		lt(documents.createdAt, savedBefore),
		or(isNull(documents.keptAt), lt(documents.keptAt, keptBefore)),
		isNull(documents.starredAt),
		isNull(documents.shortlistedAt),
		sql`coalesce(${documents.note}, '') = ''`,
		sql`coalesce(${documents.editionNote}, '') = ''`,
		notExists(
			db
				.select({ one: sql`1` })
				.from(highlights)
				.where(and(eq(highlights.documentId, documents.id), isNull(highlights.deletedAt))),
		),
	) as SQL
}

/** A save to review: a library card, with whether it is an article or a post. */
export type ReviewItem = LibraryCard & { type: "article" | "post" }

/** The oldest `REVIEW.pageSize` saves to review, and whether there are more after them. */
export async function listReview(
	userId: string,
	{ now = new Date(), limit = REVIEW.pageSize }: { now?: Date; limit?: number } = {},
): Promise<{ items: ReviewItem[]; more: boolean }> {
	const rows = await db
		.select({ ...libraryCardColumns, type: documents.type })
		.from(documents)
		.where(reviewWhere(userId, now))
		.orderBy(documents.createdAt, documents.id)
		.limit(limit + 1)
	return { items: rows.slice(0, limit), more: rows.length > limit }
}

/**
 * Whether Home suggests the review: at least `REVIEW.minToSuggest` saves in it, and the card not
 * put off (`snoozeReview`).
 */
export async function reviewSuggested(userId: string, now = new Date()): Promise<boolean> {
	const [row] = await db
		.select({ after: sql<string | null>`${userTable.prefs}->>'reviewSuggestAfter'` })
		.from(userTable)
		.where(eq(userTable.id, userId))
	if (row?.after && new Date(row.after) > now) return false
	const some = db
		.select({ id: documents.id })
		.from(documents)
		.where(reviewWhere(userId, now))
		.limit(REVIEW.minToSuggest)
		.as("some")
	const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(some)
	return (count?.n ?? 0) >= REVIEW.minToSuggest
}

/** No card for the review on Home for `REVIEW.snoozeDays`. */
export async function snoozeReview(userId: string, now = new Date()): Promise<void> {
	const after = new Date(now.getTime() + REVIEW.snoozeDays * DAY_MS).toISOString()
	await db
		.update(userTable)
		.set({
			prefs: sql`${userTable.prefs} || jsonb_build_object('reviewSuggestAfter', ${after}::text)`,
		})
		.where(eq(userTable.id, userId))
}
