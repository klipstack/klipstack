import { TOPIC_RULES } from "@klipstack/ai"
import {
	and,
	asc,
	count,
	db,
	desc,
	documents,
	documentTopics,
	eq,
	inArray,
	isNull,
	ne,
	not,
	sql,
	topicLibraries,
	topicSorts,
	topics,
} from "@klipstack/db"
import { finished, type LibraryCard, libraryCardColumns } from "./documents.server"

/**
 * Where a reader's topics stand. `waiting`: fewer articles than the first topics need (`count` of
 * `needed`). `proposing`: enough, the worker is on it. `proposed`: the first topics wait for the
 * reader. `active`: confirmed, kept up to date.
 */
export type TopicsStage = "off" | "waiting" | "proposing" | "proposed" | "active"

export interface TopicSummary {
	id: string
	name: string
	description: string
	/** Articles in it, out of the trash. */
	articles: number
}

/** An article on a topic's shelf, as its spine shows it. */
export interface TopicBook {
	id: string
	title: string | null
	siteName: string | null
	wordCount: number | null
	/** Saved in the last seven days. */
	recent: boolean
}

/** A topic on the Topics page: its newest articles, and how many were saved this week. */
export interface TopicShelf extends TopicSummary {
	/** The newest `SHELF_BOOKS`, newest first; the topic's page has them all. */
	books: TopicBook[]
	/** Articles in it saved in the last seven days. */
	recent: number
}

/** The most books a shelf holds. */
export const SHELF_BOOKS = 16

export interface TopicsState {
	stage: TopicsStage
	/** Ready articles in the library, out of the trash; and how many the first topics need. */
	count: number
	needed: number
	/** The first topics, while `proposed`; the topics, while `active`, largest first. */
	topics: TopicShelf[]
	/** The proposal is ready and the reader has not opened it: the sidebar's dot. */
	unseen: boolean
	/** Articles still to sort, while `active`: the whole library, right after the reader confirms. */
	sorting: number
}

const inLibrary = (userId: string) =>
	and(
		eq(documents.userId, userId),
		eq(documents.status, "ready"),
		eq(documents.type, "article"),
		isNull(documents.deletedAt),
	)

export async function topicsState(userId: string): Promise<TopicsState> {
	const [library] = await db.select().from(topicLibraries).where(eq(topicLibraries.userId, userId))
	const empty = {
		count: 0,
		needed: TOPIC_RULES.bootstrapSize,
		topics: [],
		unseen: false,
		sorting: 0,
	}
	if (!library) return { stage: "off", ...empty }
	const [{ total } = { total: 0 }] = await db
		.select({ total: count() })
		.from(documents)
		.where(inLibrary(userId))
	// An empty proposal waits for more articles before the next one.
	const needed =
		library.proposedAtCount === null
			? TOPIC_RULES.bootstrapSize
			: library.proposedAtCount + TOPIC_RULES.poolSize
	if (!library.proposedAt)
		return { ...empty, stage: total >= needed ? "proposing" : "waiting", count: total, needed }
	const status = library.confirmedAt ? "active" : "proposed"
	return {
		stage: status,
		count: total,
		needed,
		topics: await summaries(userId, status),
		unseen: !library.confirmedAt && !library.seenAt,
		sorting: status === "active" ? total - (await sortedCount(userId)) : 0,
	}
}

async function sortedCount(userId: string): Promise<number> {
	const [row] = await db
		.select({ sorted: count() })
		.from(topicSorts)
		.innerJoin(documents, eq(documents.id, topicSorts.documentId))
		.where(and(eq(topicSorts.userId, userId), inLibrary(userId)))
	return row?.sorted ?? 0
}

async function summaries(userId: string, status: "active" | "proposed"): Promise<TopicShelf[]> {
	const articles = sql<number>`count(${documents.id})::int`
	const recent = sql<number>`(count(${documents.id}) filter (where ${savedThisWeek}))::int`
	const rows = await db
		.select({
			id: topics.id,
			name: topics.name,
			description: topics.description,
			articles,
			recent,
		})
		.from(topics)
		.leftJoin(documentTopics, applied)
		.leftJoin(documents, and(eq(documents.id, documentTopics.documentId), inLibrary(userId)))
		.where(and(eq(topics.userId, userId), eq(topics.status, status)))
		.groupBy(topics.id)
		.orderBy(desc(articles), asc(topics.name))
	// The first topics, still proposed, hold no articles yet: only confirmed ones have shelves.
	const shelved = status === "active" ? await books(userId) : new Map<string, TopicBook[]>()
	return rows.map((row) => ({ ...row, books: shelved.get(row.id) ?? [] }))
}

/** "New" on a shelf: saved in the last seven days. */
const savedThisWeek = sql`${documents.createdAt} > now() - interval '7 days'`

/** A topic's articles: those sorted into it, less the ones the reader took out. */
const applied = and(
	eq(documentTopics.topicId, topics.id),
	eq(documentTopics.level, "applied"),
	isNull(documentTopics.refusedAt),
)

/** Each active topic's newest `SHELF_BOOKS` articles, by topic. */
async function books(userId: string) {
	const ranked = db
		.select({
			topicId: documentTopics.topicId,
			id: documents.id,
			title: documents.title,
			siteName: documents.siteName,
			wordCount: documents.wordCount,
			recent: sql<boolean>`${savedThisWeek}`.as("recent"),
			rank: sql<number>`row_number() over (partition by ${documentTopics.topicId} order by ${documents.createdAt} desc, ${documents.id})`.as(
				"rank",
			),
		})
		.from(topics)
		.innerJoin(documentTopics, applied)
		.innerJoin(documents, and(eq(documents.id, documentTopics.documentId), inLibrary(userId)))
		.where(and(eq(topics.userId, userId), eq(topics.status, "active")))
		.as("ranked")
	const rows = await db
		.select()
		.from(ranked)
		.where(sql`${ranked.rank} <= ${SHELF_BOOKS}`)
		.orderBy(asc(ranked.rank))
	const shelves = new Map<string, TopicBook[]>()
	for (const { topicId, rank: _, ...book } of rows) {
		const shelf = shelves.get(topicId) ?? []
		shelf.push(book)
		shelves.set(topicId, shelf)
	}
	return shelves
}

/**
 * The first topics wait for the reader, who has not opened them: `dot` for the sidebar, until
 * they open the proposal; `card` for Home, unless "Not now" put it away first.
 */
export async function firstTopicsNotice(userId: string): Promise<{ dot: boolean; card: boolean }> {
	const [row] = await db
		.select({ cardDismissedAt: topicLibraries.cardDismissedAt })
		.from(topicLibraries)
		.where(
			and(
				eq(topicLibraries.userId, userId),
				sql`${topicLibraries.proposedAt} is not null`,
				isNull(topicLibraries.seenAt),
				isNull(topicLibraries.confirmedAt),
			),
		)
	return { dot: !!row, card: !!row && !row.cardDismissedAt }
}

/** Whether the reader has topics, on or waiting: they may turn them off even without the feature. */
export async function hasTopics(userId: string): Promise<boolean> {
	const [row] = await db
		.select({ userId: topicLibraries.userId })
		.from(topicLibraries)
		.where(eq(topicLibraries.userId, userId))
	return !!row
}

/** A topic of the reader's with its articles, most fitting first. Null for none of theirs. */
export async function topicWithArticles(
	userId: string,
	topicId: string,
): Promise<{ topic: TopicSummary; items: LibraryCard[] } | null> {
	const [topic] = await db
		.select({ id: topics.id, name: topics.name, description: topics.description })
		.from(topics)
		.where(and(eq(topics.id, topicId), eq(topics.userId, userId), eq(topics.status, "active")))
	if (!topic) return null
	const items = await db
		.select(libraryCardColumns)
		.from(documentTopics)
		.innerJoin(documents, eq(documents.id, documentTopics.documentId))
		.where(
			and(
				eq(documentTopics.topicId, topicId),
				eq(documentTopics.level, "applied"),
				isNull(documentTopics.refusedAt),
				inLibrary(userId),
			),
		)
		.orderBy(desc(documents.createdAt), asc(documents.id))
	return { topic: { ...topic, articles: items.length }, items }
}

/** Articles on the reader's shelf at the end of an article. */
export const READER_SHELF_SIZE = 3

export interface ReaderTopic {
	id: string
	name: string
}

export interface ShelfArticle {
	id: string
	title: string | null
	siteName: string | null
	sourceUrl: string
	readingMinutes: number | null
}

export interface ReaderTopics {
	/** The topics the article is in, strongest first. */
	topics: ReaderTopic[]
	/**
	 * What to read next: unread articles of the article's strongest topic that has any, closest
	 * first, with how many unread it holds. Null when none of its topics has one.
	 */
	shelf: { topic: ReaderTopic; unread: number; items: ShelfArticle[] } | null
}

/**
 * An article's topics for the reader, and the shelf at its end. Articles are compared by the
 * topic scores kept for them (applied and suggested): two that lean on the same topics in the
 * same proportions are closest. No model is asked anything.
 */
export async function readerTopics(userId: string, documentId: string): Promise<ReaderTopics> {
	const placed = await db
		.select({
			id: topics.id,
			name: topics.name,
			probability: documentTopics.probability,
			level: documentTopics.level,
		})
		.from(documentTopics)
		.innerJoin(topics, eq(topics.id, documentTopics.topicId))
		.innerJoin(documents, eq(documents.id, documentTopics.documentId))
		.where(
			and(
				eq(documentTopics.documentId, documentId),
				isNull(documentTopics.refusedAt),
				eq(topics.userId, userId),
				eq(topics.status, "active"),
				eq(documents.userId, userId),
				isNull(documents.deletedAt),
			),
		)
		.orderBy(desc(documentTopics.probability), asc(topics.name))
	const applied = placed
		.filter((p) => p.level === "applied")
		.map(({ id, name }): ReaderTopic => ({ id, name }))
	if (applied.length === 0) return { topics: applied, shelf: null }
	// How close each article is to this one: the cosine of their topic scores, in active topics,
	// without this one's length, the same for every article. Ranked in the database: a topic may
	// hold thousands of unread articles, and three are shown.
	const mine = sql.join(
		placed.map((p) => sql`(${p.id}::uuid, ${p.probability}::float8)`),
		sql`, `,
	)
	const closeness = sql<number>`coalesce((
		select sum(s.probability * m.p) / nullif(sqrt(sum(s.probability * s.probability)), 0)
		from ${documentTopics} s
		join ${topics} st on st.id = s.topic_id and st.status = 'active'
		left join (values ${mine}) as m(topic_id, p) on m.topic_id = s.topic_id
		where s.document_id = ${documents.id} and s.refused_at is null
	), 0)`
	for (const topic of applied) {
		const onShelf = and(
			eq(documentTopics.topicId, topic.id),
			eq(documentTopics.level, "applied"),
			isNull(documentTopics.refusedAt),
			inLibrary(userId),
			isNull(documents.archivedAt),
			not(finished),
			ne(documents.id, documentId),
		)
		const [{ unread } = { unread: 0 }] = await db
			.select({ unread: count() })
			.from(documentTopics)
			.innerJoin(documents, eq(documents.id, documentTopics.documentId))
			.where(onShelf)
		if (unread === 0) continue
		const items: ShelfArticle[] = await db
			.select({
				id: documents.id,
				title: documents.title,
				siteName: documents.siteName,
				sourceUrl: documents.sourceUrl,
				readingMinutes: documents.readingMinutes,
			})
			.from(documentTopics)
			.innerJoin(documents, eq(documents.id, documentTopics.documentId))
			.where(onShelf)
			.orderBy(desc(closeness), desc(documents.createdAt), asc(documents.id))
			.limit(READER_SHELF_SIZE)
		return { topics: applied, shelf: { topic, unread, items } }
	}
	return { topics: applied, shelf: null }
}

/** A topic as Home offers it: what is left to read in it, and when the reader last read from it. */
export interface HomeTopic {
	id: string
	name: string
	/** Articles in it, in the library, not finished: unread or in progress. */
	toRead: number
	lastRead: Date | null
}

/**
 * The reader's topics with something to read, most to read first, for Home's topic choice; and the
 * one to offer as something different: the topic read from least lately, never read first. Only
 * offered with two topics or more to choose from.
 */
export async function homeTopics(
	userId: string,
): Promise<{ topics: HomeTopic[]; different: string | null }> {
	const toRead = sql<number>`count(${documents.id}) filter (where ${documents.archivedAt} is null and not ${finished})::int`
	const lastRead = sql<Date | null>`greatest(max(${documents.lastReadAt}), max(${documents.readAt}))`
	const rows = await db
		.select({ id: topics.id, name: topics.name, toRead, lastRead })
		.from(topics)
		.innerJoin(
			documentTopics,
			and(
				eq(documentTopics.topicId, topics.id),
				eq(documentTopics.level, "applied"),
				isNull(documentTopics.refusedAt),
			),
		)
		.innerJoin(documents, and(eq(documents.id, documentTopics.documentId), inLibrary(userId)))
		.where(and(eq(topics.userId, userId), eq(topics.status, "active")))
		.groupBy(topics.id)
		.having(sql`${toRead} > 0`)
		.orderBy(desc(toRead), asc(topics.name))
	const list = rows.map((row) => ({
		...row,
		lastRead: row.lastRead ? new Date(row.lastRead) : null,
	}))
	const different =
		list.length < 2
			? null
			: list.toSorted(
					(a, b) =>
						(a.lastRead?.getTime() ?? 0) - (b.lastRead?.getTime() ?? 0) ||
						b.toRead - a.toRead ||
						a.name.localeCompare(b.name),
				)[0]!.id
	return { topics: list, different }
}

/** For each of the reader's articles given, the name of the topic it fits best, if any. */
export async function topicLabels(
	userId: string,
	documentIds: string[],
): Promise<Record<string, string>> {
	if (!documentIds.length) return {}
	const rows = await db
		.selectDistinctOn([documentTopics.documentId], {
			documentId: documentTopics.documentId,
			name: topics.name,
		})
		.from(documentTopics)
		.innerJoin(topics, eq(topics.id, documentTopics.topicId))
		.where(
			and(
				inArray(documentTopics.documentId, documentIds),
				eq(topics.userId, userId),
				eq(topics.status, "active"),
				eq(documentTopics.level, "applied"),
				isNull(documentTopics.refusedAt),
			),
		)
		.orderBy(documentTopics.documentId, desc(documentTopics.probability), asc(topics.name))
	return Object.fromEntries(rows.map((row) => [row.documentId, row.name]))
}
