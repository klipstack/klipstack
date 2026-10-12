import {
	and,
	db,
	documents,
	documentTopics,
	eq,
	exists,
	isNull,
	notExists,
	type SQL,
	sql,
	topicSorts,
	topics,
} from "@klipstack/db"

/**
 * Which articles a topic holds, as conditions on `documents`: the library's lists, Home and the
 * search narrow by them. An article is in a topic when it is listed under it and the reader has not
 * taken it out: suggested is not in it.
 */

/** Listed under one of the reader's active topics. */
const inSomeTopic = and(
	eq(documentTopics.documentId, documents.id),
	eq(documentTopics.level, "applied"),
	isNull(documentTopics.refusedAt),
	eq(topics.status, "active"),
	eq(topics.userId, documents.userId),
)

/** In the topic with that id (the reader's own: the documents are theirs). */
export function inTopic(topicId: string): SQL {
	return exists(
		db
			.select({ one: sql`1` })
			.from(documentTopics)
			.where(
				and(
					eq(documentTopics.documentId, documents.id),
					eq(documentTopics.topicId, topicId),
					eq(documentTopics.level, "applied"),
					isNull(documentTopics.refusedAt),
				),
			),
	)
}

/**
 * Sorted, and in none of the reader's topics. An article not sorted yet is not in it: it may still
 * find a topic.
 */
export const inNoTopic: SQL = and(
	exists(
		db
			.select({ one: sql`1` })
			.from(topicSorts)
			.where(eq(topicSorts.documentId, documents.id)),
	),
	notExists(
		db
			.select({ one: sql`1` })
			.from(documentTopics)
			.innerJoin(topics, eq(topics.id, documentTopics.topicId))
			.where(inSomeTopic),
	),
) as SQL

/** Not sorted into the topics yet. */
export const notSorted: SQL = notExists(
	db
		.select({ one: sql`1` })
		.from(topicSorts)
		.where(eq(topicSorts.documentId, documents.id)),
)

/**
 * For `has:topic` and `topic:` in the search: the article is in one of its reader's topics (with
 * that name). A topic name may hold a quote, which `topic:"…"` cannot: names match without them.
 */
export function articleInTopic(name?: string): SQL {
	return exists(
		db
			.select({ one: sql`1` })
			.from(documentTopics)
			.innerJoin(topics, eq(topics.id, documentTopics.topicId))
			.where(
				and(
					inSomeTopic,
					name === undefined
						? undefined
						: sql`lower(replace(${topics.name}, '"', '')) = lower(${name})`,
				),
			),
	)
}
