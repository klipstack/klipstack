import {
	and,
	db,
	documents,
	eq,
	isNotNull,
	isNull,
	lt,
	lte,
	not,
	or,
	type SQL,
	type SQLWrapper,
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

type TimeChoice = (typeof TIME_CHOICES)[number]

/**
 * Minutes left: at least one, and what Home's cards show. Null for posts, which are a glance, and
 * for articles without a length. Progress is a `real`, so 0.9 is stored as 0.8999999762: the
 * thousandth of a minute taken off keeps a 50-minute article at 0.9 at 5 minutes left, not 6.
 * Plain floats: Home's queries count this nine times an article.
 */
const minutesLeft = sql<
	number | null
>`case when ${documents.type} = 'article' and ${documents.readingMinutes} > 0 then greatest(1, ceil(${documents.readingMinutes} * (1 - ${documents.readingProgress}::float8) - 0.001))::int end`

/** Fits in `t` minutes and takes at least half of them: `fillsTime` in `~/lib/home-shelves`. */
const fills = (left: SQLWrapper, t: number) => sql`(${left} <= ${t} and ${left} * 2 >= ${t})`

/** Never opened, and not marked finished either (imports can bring read articles never opened). */
const unread = and(INBOX_FILTER_WHERE.unread, not(finished)) as SQL

/** Ready articles in the reader's library. */
function suggestable(userId: string) {
	return and(
		eq(documents.userId, userId),
		isNull(documents.deletedAt),
		isNull(documents.archivedAt),
		eq(documents.status, "ready"),
	)
}

/**
 * Unread saves from a while ago, so older ones come back instead of sinking under newer ones. The
 * pick changes each day (UTC) and holds through the day: reloading Home doesn't shuffle it, and the
 * cutoff moves a day at a time, at the start of the day.
 */
function rediscover(now: Date) {
	const day = now.toISOString().slice(0, 10)
	const savedBefore = new Date(Date.parse(day) - REDISCOVER_AFTER_DAYS * 86_400_000)
	return {
		savedBefore,
		where: and(unread, lt(documents.createdAt, savedBefore)) as SQL,
		order: { key: sql`md5(${documents.id}::text || ${day})`, desc: false },
	}
}

export type HomeCard = LibraryCard & { minutesLeft: number | null }

/**
 * How many of each kind `candidates` keeps per section: Home's shelf sizes, and for the older saves
 * room for those Recently saved already shows.
 */
const KEEP: Record<"reading" | "recent" | "rediscover", number> = {
	reading: HOME_SHELF.reading,
	recent: HOME_SHELF.recent,
	rediscover: HOME_SHELF.recent + HOME_SHELF.rediscover,
}

/**
 * Home's candidates for a section, so the page can choose a time without asking again: in the
 * section's order (`key`, then id, in one direction), the first `keep` articles of any length, and for each time choice the first
 * `keep` that fit it and the first `keep` that fill at least half of it (`homeShelves`). One query,
 * ranking with running counts.
 */
async function candidates(
	userId: string,
	where: SQL,
	order: { key: SQL; desc: boolean },
	keep: number,
) {
	const dir = sql.raw(order.desc ? "desc" : "asc")
	const over = sql`over (order by ${order.key} ${dir}, ${documents.id} ${dir} rows between unbounded preceding and current row)`
	const counts = {} as Record<`${"fits" | "fills"}${TimeChoice}`, SQL.Aliased<number>>
	for (const t of TIME_CHOICES) {
		counts[`fits${t}`] = sql<number>`count(*) filter (where ${minutesLeft} <= ${t}) ${over}`.as(
			`fits${t}`,
		)
		counts[`fills${t}`] = sql<number>`count(*) filter (where ${fills(minutesLeft, t)}) ${over}`.as(
			`fills${t}`,
		)
	}
	const ranked = db
		.select({
			id: documents.id,
			left: minutesLeft.as("left"),
			rank: sql<number>`row_number() ${over}`.as("rank"),
			...counts,
		})
		.from(documents)
		.where(and(suggestable(userId), where))
		.as("ranked")
	// Chosen and bounded before the join, so the database reads only those articles, by id.
	const picked = db
		.select({ id: ranked.id, left: ranked.left, rank: ranked.rank })
		.from(ranked)
		.where(
			or(
				lte(ranked.rank, keep),
				...TIME_CHOICES.flatMap((t) => [
					and(lte(ranked.left, t), lte(ranked[`fits${t}`], keep)),
					and(fills(ranked.left, t), lte(ranked[`fills${t}`], keep)),
				]),
			),
		)
		.orderBy(ranked.rank)
		.limit(keep * (1 + 2 * TIME_CHOICES.length))
		.as("picked")
	return db
		.select({ ...libraryCardColumns, minutesLeft: picked.left })
		.from(documents)
		.innerJoin(picked, eq(picked.id, documents.id))
		.orderBy(picked.rank)
}

/**
 * The articles in progress (read last first), the unread saves (newest first) and the unread
 * saves from a while ago (the day's pick) Home chooses from, and when "a while ago" starts: with a
 * time chosen, Recently saved keeps to the saves after it. `keep` is for tests, to compare with
 * everything.
 */
export async function homeCandidates(
	userId: string,
	{ now = new Date(), keep = KEEP }: { now?: Date; keep?: typeof KEEP } = {},
): Promise<{
	reading: HomeCard[]
	recent: HomeCard[]
	rediscover: HomeCard[]
	recentSince: Date
}> {
	const older = rediscover(now)
	const [reading, recent, rediscovered] = await Promise.all([
		candidates(
			userId,
			INBOX_FILTER_WHERE.progress,
			{
				key: sql`coalesce(${documents.lastReadAt}, ${documents.firstOpenedAt}, ${documents.createdAt})`,
				desc: true,
			},
			keep.reading,
		),
		candidates(userId, unread, { key: sql`${documents.createdAt}`, desc: true }, keep.recent),
		candidates(userId, older.where, older.order, keep.rediscover),
	])
	return { reading, recent, rediscover: rediscovered, recentSince: older.savedBefore }
}

/** Unfinished articles with a reading time: what a time choice narrows down. */
export async function countUnfinished(userId: string) {
	const [row] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(documents)
		.where(and(suggestable(userId), not(finished), isNotNull(minutesLeft)))
	return row?.count ?? 0
}
