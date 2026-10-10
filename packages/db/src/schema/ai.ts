import { relations } from "drizzle-orm"
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core"
import { newId } from "../ids"
import { documents, documentVersions, highlights } from "./app"
import { user } from "./auth"

/**
 * What the reader asked of a passage, or `chat`: the article's one conversation, about all of it.
 */
export const aiActions = ["explain", "define", "ask", "chat"] as const
export type AiThreadAction = (typeof aiActions)[number]

/** A passage of the article an answer cites: a range of its version's text, and where in the answer. */
export interface AiCitation {
	start: number
	end: number
	exact: string
	/** Position in the answer's text, right after the words it supports. */
	at: number
}

/**
 * Questions about a passage and their answers, anchored to the text like highlights (same
 * selector, re-anchored the same way when the article is extracted again). Soft-deleted, for undo.
 */
export const aiThreads = pgTable(
	"ai_threads",
	{
		id: uuid("id").primaryKey().$defaultFn(newId),
		documentId: uuid("document_id")
			.notNull()
			.references(() => documents.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		versionId: uuid("version_id")
			.notNull()
			.references(() => documentVersions.id, { onDelete: "cascade" }),
		startOffset: integer("start_offset").notNull(),
		endOffset: integer("end_offset").notNull(),
		exact: text("exact").notNull(),
		prefix: text("prefix").notNull().default(""),
		suffix: text("suffix").notNull().default(""),
		action: text("action", { enum: aiActions }).notNull(),
		/** Asked from a highlight's toolbar: the thread stays when the highlight goes. */
		highlightId: uuid("highlight_id").references(() => highlights.id, { onDelete: "set null" }),
		orphaned: boolean("orphaned").notNull().default(false),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		deletedAt: timestamp("deleted_at", { withTimezone: true }),
	},
	(t) => [
		index("ai_threads_document_idx").on(t.documentId),
		index("ai_threads_user_created_idx").on(t.userId, t.createdAt.desc()),
		index("ai_threads_version_idx").on(t.versionId),
		index("ai_threads_highlight_idx").on(t.highlightId),
	],
)

/**
 * A thread's turns: the reader's questions and the answers. An answer is written when it ends,
 * with what it cost; `failed` keeps a broken-off answer's place, so the card offers Retry.
 */
export const aiMessages = pgTable(
	"ai_messages",
	{
		id: uuid("id").primaryKey().$defaultFn(newId),
		threadId: uuid("thread_id")
			.notNull()
			.references(() => aiThreads.id, { onDelete: "cascade" }),
		role: text("role", { enum: ["user", "assistant"] }).notNull(),
		text: text("text").notNull(),
		citations: jsonb("citations").$type<AiCitation[]>().notNull().default([]),
		status: text("status", { enum: ["done", "failed", "refused"] })
			.notNull()
			.default("done"),
		/** `provider:model`, for answers. */
		model: text("model"),
		inputTokens: integer("input_tokens"),
		outputTokens: integer("output_tokens"),
		cacheReadTokens: integer("cache_read_tokens"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("ai_messages_thread_created_idx").on(t.threadId, t.createdAt)],
)

/**
 * An article's brief: a short cited summary the reader asked for, one per version of the article. A
 * new version needs a new one.
 */
export const aiBriefs = pgTable(
	"ai_briefs",
	{
		id: uuid("id").primaryKey().$defaultFn(newId),
		documentId: uuid("document_id")
			.notNull()
			.references(() => documents.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		versionId: uuid("version_id")
			.notNull()
			.references(() => documentVersions.id, { onDelete: "cascade" }),
		text: text("text").notNull(),
		citations: jsonb("citations").$type<AiCitation[]>().notNull().default([]),
		/** `provider:model`. */
		model: text("model").notNull(),
		inputTokens: integer("input_tokens"),
		outputTokens: integer("output_tokens"),
		cacheReadTokens: integer("cache_read_tokens"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("ai_briefs_version_idx").on(t.versionId),
		index("ai_briefs_document_idx").on(t.documentId),
		index("ai_briefs_user_created_idx").on(t.userId, t.createdAt.desc()),
	],
)

export const aiThreadsRelations = relations(aiThreads, ({ many }) => ({
	messages: many(aiMessages),
}))

export const aiMessagesRelations = relations(aiMessages, ({ one }) => ({
	thread: one(aiThreads, { fields: [aiMessages.threadId], references: [aiThreads.id] }),
}))

export type AiThread = typeof aiThreads.$inferSelect
export type AiMessage = typeof aiMessages.$inferSelect
export type AiBrief = typeof aiBriefs.$inferSelect
