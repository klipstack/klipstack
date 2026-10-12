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
	isNull,
	sql,
	topicLibraries,
	topicSorts,
	topics,
} from "@klipstack/db"
import { type LibraryCard, libraryCardColumns } from "./documents.server"

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

export interface TopicsState {
	stage: TopicsStage
	/** Ready articles in the library, out of the trash; and how many the first topics need. */
	count: number
	needed: number
	/** The first topics, while `proposed`; the topics, while `active`, largest first. */
	topics: TopicSummary[]
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

async function summaries(userId: string, status: "active" | "proposed"): Promise<TopicSummary[]> {
	const articles = sql<number>`count(${documents.id})::int`
	const rows = await db
		.select({
			id: topics.id,
			name: topics.name,
			description: topics.description,
			articles,
		})
		.from(topics)
		.leftJoin(
			documentTopics,
			and(
				eq(documentTopics.topicId, topics.id),
				eq(documentTopics.level, "applied"),
				isNull(documentTopics.refusedAt),
			),
		)
		.leftJoin(documents, and(eq(documents.id, documentTopics.documentId), inLibrary(userId)))
		.where(and(eq(topics.userId, userId), eq(topics.status, status)))
		.groupBy(topics.id)
		.orderBy(desc(articles), asc(topics.name))
	return rows
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
