import { relations } from "drizzle-orm"
import {
	boolean,
	index,
	integer,
	pgTable,
	primaryKey,
	real,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core"
import { newId } from "../ids"
import { documents } from "./app"
import { user } from "./auth"

/**
 * A reader's automatic topics, from the moment they turn them on: when the first topics were
 * proposed and confirmed, and what the worker needs to decide when to grow or review them. No row:
 * topics are off. Turning them off deletes the row with the reader's topics and sorts.
 */
export const topicLibraries = pgTable("topic_libraries", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	enabledAt: timestamp("enabled_at", { withTimezone: true }).notNull().defaultNow(),
	/** The library's size when the first topics were last asked for: a failed ask waits for more. */
	proposedAtCount: integer("proposed_at_count"),
	/** When the first topics were proposed, waiting for the reader to confirm them. */
	proposedAt: timestamp("proposed_at", { withTimezone: true }),
	/** When the reader opened the proposal: the sidebar's dot and Home's card go. */
	seenAt: timestamp("seen_at", { withTimezone: true }),
	confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
	/** Unsorted articles when a new topic was last asked for: the next ask waits for more. */
	unsortedAtLastGrow: integer("unsorted_at_last_grow").notNull().default(0),
	/** Articles sorted since the last review of the topics. */
	sortedSinceReview: integer("sorted_since_review").notNull().default(0),
})

/**
 * `proposed`: in the first set, waiting for the reader. `retired`: merged, split or retired by a
 * review. `removed`: by the reader; kept so that a topic of the same name is not proposed again.
 */
export const topicStatus = ["proposed", "active", "retired", "removed"] as const
export type TopicStatus = (typeof topicStatus)[number]
/** How a topic came to be: the first set, from articles no topic held, or a review's change. */
export const topicOrigin = ["first", "grown", "split", "merged"] as const

export const topics = pgTable(
	"topics",
	{
		id: uuid("id").primaryKey().$defaultFn(newId),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		/** What belongs on the shelf and what does not: what Jev sorts articles by. */
		description: text("description").notNull(),
		status: text("status", { enum: topicStatus }).notNull(),
		origin: text("origin", { enum: topicOrigin }).notNull(),
		/** The reader named it: a review never renames it. */
		namedByReader: boolean("named_by_reader").notNull().default(false),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		/** Retired or removed since. */
		endedAt: timestamp("ended_at", { withTimezone: true }),
	},
	(t) => [index("topics_user_status_idx").on(t.userId, t.status)],
)

export type Topic = typeof topics.$inferSelect

/**
 * Which topics an article is in: `applied` it is listed under, `suggested` it nearly is. A row with
 * `refusedAt` is the reader taking the article out of the topic: sorting never puts it back.
 */
export const documentTopics = pgTable(
	"document_topics",
	{
		documentId: uuid("document_id")
			.notNull()
			.references(() => documents.id, { onDelete: "cascade" }),
		topicId: uuid("topic_id")
			.notNull()
			.references(() => topics.id, { onDelete: "cascade" }),
		probability: real("probability").notNull(),
		level: text("level", { enum: ["applied", "suggested"] }).notNull(),
		refusedAt: timestamp("refused_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.documentId, t.topicId] }),
		// The primary key leads with the article: this one finds the articles of a topic.
		index("document_topics_topic_idx").on(t.topicId),
	],
)

/**
 * The articles sorted since the reader confirmed their topics. An article sorted into no topic is
 * unsorted; one not here yet waits for sorting.
 */
export const topicSorts = pgTable(
	"topic_sorts",
	{
		documentId: uuid("document_id")
			.primaryKey()
			.references(() => documents.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		sortedAt: timestamp("sorted_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("topic_sorts_user_idx").on(t.userId)],
)

export const topicsRelations = relations(topics, ({ many }) => ({
	documents: many(documentTopics),
}))

export const documentTopicsRelations = relations(documentTopics, ({ one }) => ({
	topic: one(topics, { fields: [documentTopics.topicId], references: [topics.id] }),
	document: one(documents, { fields: [documentTopics.documentId], references: [documents.id] }),
}))
