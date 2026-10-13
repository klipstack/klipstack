import {
	and,
	byName,
	db,
	documents,
	documentTags,
	documentTopics,
	eq,
	highlights,
	isNull,
	lte,
	sql,
	tags,
	topics,
} from "@klipstack/db"
import type { HighlightFilter } from "~/lib/highlight-filters"
import {
	type HighlightListItem,
	type HighlightScope,
	listColumns,
	matchingWhere,
} from "./highlights.server"

/**
 * The highlights page's board: highlights by topic, a random hand of them, and the tags to narrow
 * them by. The stream and by article are in `highlights.server.ts`.
 */

interface Matching {
	userId: string
	q?: string
	filter?: HighlightFilter | null
	scope?: HighlightScope
}

export interface HighlightTopicGroup {
	/** Null: the articles in none of the reader's topics. */
	topicId: string | null
	name: string | null
	/** Matching highlights under the topic, all of them; `highlights` holds the newest few. */
	count: number
	highlights: HighlightListItem[]
}

/** The newest highlights a topic shows on the page; the rest are a click away. */
export const TOPIC_GROUP_SIZE = 6

/**
 * Matching highlights under their articles' topics: an article listed under two topics shows its
 * highlights under both, as the library's topic filter lists it under both. Articles in none (not
 * sorted yet, or sorted into none) are the last group. Each group holds its newest `perTopic`, in
 * one query however large the library: the database counts and ranks them.
 * Topics most highlighted first.
 */
export async function listHighlightTopics({
	perTopic = TOPIC_GROUP_SIZE,
	...matching
}: Matching & { perTopic?: number }): Promise<HighlightTopicGroup[]> {
	const placed = db
		.select({
			documentId: documentTopics.documentId,
			topicId: sql<string>`${topics.id}`.as("topic_id"),
			topicName: sql<string>`${topics.name}`.as("topic_name"),
		})
		.from(documentTopics)
		.innerJoin(topics, eq(topics.id, documentTopics.topicId))
		.where(
			and(
				eq(topics.userId, matching.userId),
				eq(topics.status, "active"),
				eq(documentTopics.level, "applied"),
				isNull(documentTopics.refusedAt),
			),
		)
		.as("placed")
	const ranked = db
		.select({
			...listColumns,
			image: listColumns.image.as("image"),
			topicId: sql<string | null>`${placed.topicId}`.as("group_id"),
			topicName: sql<string | null>`${placed.topicName}`.as("group_name"),
			rank: sql<number>`row_number() over (partition by ${placed.topicId} order by ${highlights.createdAt} desc, ${highlights.id} desc)`.as(
				"rank",
			),
			total: sql<number>`count(*) over (partition by ${placed.topicId})`.as("total"),
		})
		.from(highlights)
		.innerJoin(documents, eq(documents.id, highlights.documentId))
		.leftJoin(placed, eq(placed.documentId, highlights.documentId))
		.where(matchingWhere(matching.userId, matching))
		.as("ranked")
	const rows = await db.select().from(ranked).where(lte(ranked.rank, perTopic)).orderBy(ranked.rank)
	const groups = new Map<string | null, HighlightTopicGroup>()
	for (const { topicId, topicName, rank: _rank, total, ...h } of rows) {
		const group = groups.get(topicId)
		if (group) group.highlights.push(h)
		else groups.set(topicId, { topicId, name: topicName, count: Number(total), highlights: [h] })
	}
	return [...groups.values()].sort(
		(a, b) =>
			Number(a.topicId === null) - Number(b.topicId === null) ||
			b.count - a.count ||
			(a.name ?? "").localeCompare(b.name ?? ""),
	)
}

/** How many highlights Shuffle deals. */
export const HAND_SIZE = 12

/**
 * A random hand of matching highlights. The seed decides it: the same seed deals the same hand
 * (less any deleted since), so the page stays put when it reloads after a change; a new seed
 * deals again.
 */
export async function dealHighlights({
	seed,
	size = HAND_SIZE,
	...matching
}: Matching & { seed: string; size?: number }): Promise<HighlightListItem[]> {
	return db
		.select(listColumns)
		.from(highlights)
		.innerJoin(documents, eq(documents.id, highlights.documentId))
		.where(matchingWhere(matching.userId, matching))
		.orderBy(sql`md5(${highlights.id}::text || ${seed})`)
		.limit(size)
}

export interface HighlightTag {
	id: string
	name: string
	/** The user's highlights in articles with the tag. */
	count: number
}

/** The user's tags whose articles have highlights, by name: what the tag filter offers. */
export async function listHighlightTags(userId: string): Promise<HighlightTag[]> {
	const rows = await db
		.select({ id: tags.id, name: tags.name, count: sql<number>`count(*)::int` })
		.from(tags)
		.innerJoin(documentTags, eq(documentTags.tagId, tags.id))
		.innerJoin(documents, eq(documents.id, documentTags.documentId))
		.innerJoin(highlights, eq(highlights.documentId, documents.id))
		.where(
			and(
				eq(tags.userId, userId),
				eq(documents.userId, userId),
				eq(highlights.userId, userId),
				isNull(documents.deletedAt),
				isNull(highlights.deletedAt),
			),
		)
		.groupBy(tags.id, tags.name)
		.orderBy(byName(tags.name))
	return rows.map((r) => ({ ...r, count: Number(r.count) }))
}

/** The name of one of the user's active topics, for the topic a list narrows to; null otherwise. */
export async function activeTopicName(userId: string, id: string): Promise<string | null> {
	const [row] = await db
		.select({ name: topics.name })
		.from(topics)
		.where(and(eq(topics.id, id), eq(topics.userId, userId), eq(topics.status, "active")))
	return row?.name ?? null
}
