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
	or,
	type SQL,
	sql,
} from "@klipstack/db"
import { HOME_SHELF } from "~/lib/home-shelves"
import { REDISCOVER_AFTER_DAYS, TIME_CHOICES } from "~/lib/inbox-filters"
import {
	finished,
	INBOX_FILTER_WHERE,
	type LibraryCard,
	libraryCardColumns,
} from "./documents.server"

/**
 * Minutes left, as the cards count them (`HomeArticle`): at least one. Null for posts, which are a
 * glance, and for articles without a length.
 */
const minutesLeft = sql<
	number | null
>`case when ${documents.type} = 'article' and ${documents.readingMinutes} is not null then greatest(1, ceil(${documents.readingMinutes} * (1 - ${documents.readingProgress})))::int end`

/** Fits in `t` minutes and takes at least half of them: `fillsTime` in `~/lib/home-shelves`. */
const fills = (t: number) => sql`(${minutesLeft} <= ${t} and ${minutesLeft} * 2 > ${t})`

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
function rediscover(now: Date) {
	const day = now.toISOString().slice(0, 10)
	const savedBefore = new Date(now.getTime() - REDISCOVER_AFTER_DAYS * 86_400_000)
	return {
		where: and(INBOX_FILTER_WHERE.unread, lt(documents.createdAt, savedBefore)) as SQL,
		order: [sql`md5(${documents.id}::text || ${day})`, sql`${documents.id}`],
	}
}

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
	const { where, order } = rediscover(now)
	return db
		.select(libraryCardColumns)
		.from(documents)
		.where(and(suggestable(userId, excludeIds), where))
		.orderBy(...order)
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

export type HomeCard = LibraryCard & { minutesLeft: number | null }

/**
 * Home's candidates for its sections, so the page can choose a time without asking again: for each
 * section, in its order, the first `keep` articles of any length, and for each time choice the
 * first `keep` that fit it and the first `keep` that fill at least half of it (`homeShelves`). One
 * query each, ranking with running counts.
 */
async function candidates(userId: string, where: SQL, order: SQL[], keep: number) {
	const over = sql`over (order by ${sql.join(order, sql`, `)} rows between unbounded preceding and current row)`
	const ranked = db
		.select({
			id: documents.id,
			rank: sql<number>`row_number() ${over}`.as("rank"),
			...Object.fromEntries(
				TIME_CHOICES.flatMap((t) => [
					[
						`fits${t}`,
						sql<number>`count(*) filter (where ${minutesLeft} <= ${t}) ${over}`.as(`fits${t}`),
					],
					[`fills${t}`, sql<number>`count(*) filter (where ${fills(t)}) ${over}`.as(`fills${t}`)],
				]),
			),
		})
		.from(documents)
		.where(and(suggestable(userId, []), where))
		.as("ranked")
	const column = (name: string) => (ranked as unknown as Record<string, SQL>)[name]!
	return db
		.select({ ...libraryCardColumns, minutesLeft })
		.from(documents)
		.innerJoin(ranked, eq(ranked.id, documents.id))
		.where(
			or(
				lte(ranked.rank, keep),
				...TIME_CHOICES.flatMap((t) => [
					and(lte(minutesLeft, t), lte(column(`fits${t}`), keep)),
					and(fills(t), lte(column(`fills${t}`), keep)),
				]),
			),
		)
		.orderBy(ranked.rank)
}

/**
 * The articles in progress (read last first), the unread saves (newest first) and the unread
 * saves from a while ago (the day's pick) Home chooses from. The last has room for those the
 * recent saves already show.
 */
export async function homeCandidates(
	userId: string,
	{ now = new Date() }: { now?: Date } = {},
): Promise<{ reading: HomeCard[]; recent: HomeCard[]; rediscover: HomeCard[] }> {
	const older = rediscover(now)
	const [reading, recent, rediscovered] = await Promise.all([
		candidates(
			userId,
			INBOX_FILTER_WHERE.progress,
			[
				desc(
					sql`coalesce(${documents.lastReadAt}, ${documents.firstOpenedAt}, ${documents.createdAt})`,
				),
				desc(documents.id),
			],
			HOME_SHELF.reading,
		),
		candidates(
			userId,
			INBOX_FILTER_WHERE.unread,
			[desc(documents.createdAt), desc(documents.id)],
			HOME_SHELF.recent,
		),
		candidates(userId, older.where, older.order, HOME_SHELF.recent + HOME_SHELF.rediscover),
	])
	return { reading, recent, rediscover: rediscovered }
}

/** Unfinished articles with a reading time: what a time choice narrows down. */
export async function countUnfinished(userId: string) {
	const [row] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(documents)
		.where(and(suggestable(userId, []), not(finished), isNotNull(minutesLeft)))
	return row?.count ?? 0
}
