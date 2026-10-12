import { relations, sql } from "drizzle-orm"
import {
	boolean,
	date,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	real,
	smallint,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core"
import { newId, newPublicId } from "../ids"
import { user } from "./auth"
import { bytea, tsvector } from "./custom-types"

const timestamps = {
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
	deletedAt: timestamp("deleted_at", { withTimezone: true }),
}

export const documentStatus = ["queued", "processing", "ready", "failed"] as const
/** What was saved: a long-form article, or a short-form post (on X). Extraction decides. */
export const documentType = ["article", "post"] as const
export type DocumentStatus = (typeof documentStatus)[number]
export const captureSource = ["web", "extension", "api", "feed"] as const
export type CaptureSource = (typeof captureSource)[number]

export const documents = pgTable(
	"documents",
	{
		id: uuid("id").primaryKey().$defaultFn(newId),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		type: text("type", { enum: documentType }).notNull().default("article"),
		sourceUrl: text("source_url").notNull(),
		/**
		 * The address as saved, without its fragment: what the worker fetches. `sourceUrl` is its
		 * normalized form, for finding the same page again, and normalizing drops parts some pages
		 * need (a trailing slash, `?s=`). Null for articles saved before it was kept.
		 */
		fetchUrl: text("fetch_url"),
		canonicalUrl: text("canonical_url"),
		urlHash: text("url_hash").notNull(),
		title: text("title"),
		/** Set by the user; extraction then leaves `title` alone. */
		titleEdited: boolean("title_edited").notNull().default(false),
		author: text("author"),
		siteName: text("site_name"),
		description: text("description"),
		language: text("language"),
		wordCount: integer("word_count"),
		readingMinutes: integer("reading_minutes"),
		publishedAt: timestamp("published_at", { withTimezone: true }),
		leadImageAssetId: uuid("lead_image_asset_id"),
		leadImageUrl: text("lead_image_url"),
		status: text("status", { enum: documentStatus }).notNull().default("queued"),
		failureReason: text("failure_reason"),
		captureSource: text("capture_source", { enum: captureSource }).notNull().default("web"),
		currentVersionId: uuid("current_version_id"),
		/** In the archive since; null while in the inbox. */
		archivedAt: timestamp("archived_at", { withTimezone: true }),
		starredAt: timestamp("starred_at", { withTimezone: true }),
		/**
		 * Marked "for next edition". Publishing an edition with the article clears it.
		 */
		shortlistedAt: timestamp("shortlisted_at", { withTimezone: true }),
		/**
		 * Kept when reviewing old saves never opened: not suggested for letting go again for a while
		 * (`REVIEW.keepDays` in the web app).
		 */
		keptAt: timestamp("kept_at", { withTimezone: true }),
		firstOpenedAt: timestamp("first_opened_at", { withTimezone: true }),
		readAt: timestamp("read_at", { withTimezone: true }),
		lastReadAt: timestamp("last_read_at", { withTimezone: true }),
		readingProgress: real("reading_progress").notNull().default(0),
		/** Last scroll position (0..1), unlike readingProgress which only ever grows. */
		readingPosition: real("reading_position").notNull().default(0),
		/** Incremented when starting over; completion history keeps earlier cycles. */
		readingCycle: integer("reading_cycle").notNull().default(0),
		/** The user's note on the whole article (Markdown by convention, shown as plain text). */
		note: text("note"),
		noteUpdatedAt: timestamp("note_updated_at", { withTimezone: true }),
		/**
		 * What to tell an edition's readers about the article, written for them while reading, unlike
		 * the private `note`. An edition that adds the article starts with it included.
		 */
		editionNote: text("edition_note"),
		/**
		 * A post that only shares a link Klipstack couldn't open: that link, and its hash. Saving the
		 * linked article later (from the browser) moves the post onto it.
		 */
		sharedUrl: text("shared_url"),
		sharedUrlHash: text("shared_url_hash"),
		search: tsvector("search"),
		...timestamps,
	},
	(t) => [
		index("documents_user_archived_idx").on(t.userId, t.archivedAt.desc()),
		index("documents_user_shared_url_idx")
			.on(t.userId, t.sharedUrlHash)
			.where(sql`${t.sharedUrlHash} is not null`),
		index("documents_user_starred_idx")
			.on(t.userId, t.starredAt)
			.where(sql`${t.starredAt} is not null`),
		index("documents_user_shortlisted_idx")
			.on(t.userId, t.shortlistedAt)
			.where(sql`${t.shortlistedAt} is not null`),
		// The library's default order: newest first, out of the archive and the trash.
		index("documents_user_inbox_created_idx")
			.on(t.userId, t.createdAt.desc())
			.where(sql`${t.archivedAt} is null and ${t.deletedAt} is null`),
		uniqueIndex("documents_user_url_hash_unique")
			.on(t.userId, t.urlHash)
			.where(sql`${t.deletedAt} is null`),
		index("documents_search_idx").using("gin", t.search),
	],
)

/**
 * How a completion was recorded: finishing one article (`manual`), reading to the end
 * (`progress`), finishing several at once (`bulk`, usually tidying up), or a read date from before
 * this history existed (`legacy`).
 */
export const completionSources = ["manual", "progress", "legacy", "bulk"] as const

/** One completion signal per reading cycle, independent of the article's current state. */
export const readingCompletions = pgTable(
	"reading_completions",
	{
		id: uuid("id").primaryKey().$defaultFn(newId),
		documentId: uuid("document_id")
			.notNull()
			.references(() => documents.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		cycle: integer("cycle").notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
		source: text("source", { enum: completionSources }).notNull(),
	},
	(t) => [
		uniqueIndex("reading_completions_document_cycle_unique").on(t.documentId, t.cycle),
		index("reading_completions_user_date_idx").on(t.userId, t.completedAt),
	],
)

export type ReadingCompletion = typeof readingCompletions.$inferSelect

export const documentRaw = pgTable(
	"document_raw",
	{
		id: uuid("id").primaryKey().$defaultFn(newId),
		documentId: uuid("document_id")
			.notNull()
			.references(() => documents.id, { onDelete: "cascade" }),
		rawHtml: bytea("raw_html").notNull(),
		finalUrl: text("final_url"),
		httpStatus: integer("http_status"),
		contentType: text("content_type"),
		source: text("source", { enum: ["fetch", "extension", "api"] }).notNull(),
		fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("document_raw_document_idx").on(t.documentId, t.fetchedAt.desc())],
)

export const documentVersions = pgTable(
	"document_versions",
	{
		id: uuid("id").primaryKey().$defaultFn(newId),
		documentId: uuid("document_id")
			.notNull()
			.references(() => documents.id, { onDelete: "cascade" }),
		rawId: uuid("raw_id").references(() => documentRaw.id, { onDelete: "set null" }),
		version: integer("version").notNull(),
		html: text("html").notNull(),
		text: text("text").notNull(),
		textHash: text("text_hash").notNull(),
		extractor: text("extractor").notNull(),
		extractorVersion: text("extractor_version").notNull(),
		imagesDone: boolean("images_done").notNull().default(false),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("document_versions_document_version_unique").on(t.documentId, t.version),
		// Deleting a raw capture (with its document) finds the versions made from it.
		index("document_versions_raw_idx").on(t.rawId),
	],
)

export const assets = pgTable(
	"assets",
	{
		id: uuid("id").primaryKey().$defaultFn(newId),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		sha256: text("sha256").notNull(),
		storageKey: text("storage_key").notNull(),
		contentType: text("content_type").notNull(),
		width: integer("width"),
		height: integer("height"),
		bytes: integer("bytes").notNull(),
		originalUrl: text("original_url"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [uniqueIndex("assets_user_sha_unique").on(t.userId, t.sha256)],
)

export const highlights = pgTable(
	"highlights",
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
		color: smallint("color").notNull().default(0),
		note: text("note"),
		orphaned: boolean("orphaned").notNull().default(false),
		...timestamps,
	},
	(t) => [
		index("highlights_document_idx").on(t.documentId),
		index("highlights_user_created_idx").on(t.userId, t.createdAt.desc()),
		// Deleting a version (with its document) finds its highlights.
		index("highlights_version_idx").on(t.versionId),
	],
)

/**
 * A link from one article's note to another article. Derived from the note text and rewritten on
 * every note save, so it is a cache, never the source of truth. Soft deletes are handled at read
 * time: deleting a document or a highlight leaves its link rows alone.
 */
export const documentLinks = pgTable(
	"document_links",
	{
		id: uuid("id").primaryKey().$defaultFn(newId),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		/** The article whose note holds the link. */
		fromDocumentId: uuid("from_document_id")
			.notNull()
			.references(() => documents.id, { onDelete: "cascade" }),
		/** The highlight whose note holds the link; null when it is the article note. */
		highlightId: uuid("highlight_id").references(() => highlights.id, { onDelete: "cascade" }),
		toDocumentId: uuid("to_document_id")
			.notNull()
			.references(() => documents.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("document_links_to_idx").on(t.toDocumentId),
		index("document_links_source_idx").on(t.fromDocumentId, t.highlightId),
		// Deleting a highlight finds its links.
		index("document_links_highlight_idx").on(t.highlightId),
	],
)

export type DocumentLink = typeof documentLinks.$inferSelect

/**
 * The addresses an article's content links to, as `documents.url_hash` would hold them. Rewritten
 * by every extraction, so it is a cache of the current version's HTML. Not a connection by itself:
 * one exists while another live article of the user has that hash, which is worked out at read time.
 */
export const documentOutlinks = pgTable(
	"document_outlinks",
	{
		documentId: uuid("document_id")
			.notNull()
			.references(() => documents.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		urlHash: text("url_hash").notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.documentId, t.urlHash] }),
		index("document_outlinks_user_hash_idx").on(t.userId, t.urlHash),
	],
)

/**
 * The short posts an article was saved through: saving a post that only wraps a link saves the
 * linked article, and keeps the post here, shown above the article.
 */
export const documentVia = pgTable(
	"document_via",
	{
		id: uuid("id").primaryKey().$defaultFn(newId),
		documentId: uuid("document_id")
			.notNull()
			.references(() => documents.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		/** The post's address, normalized: saving it again finds the article. */
		url: text("url").notNull(),
		urlHash: text("url_hash").notNull(),
		author: text("author"),
		siteName: text("site_name"),
		/** The post as extracted, sanitized, without its pictures. */
		html: text("html").notNull(),
		publishedAt: timestamp("published_at", { withTimezone: true }),
		/** The post's capture, to read the post instead. Null when merged into an earlier save. */
		rawId: uuid("raw_id").references(() => documentRaw.id, { onDelete: "set null" }),
		/**
		 * The article the post was first saved as, removed when the post joined this one, which
		 * was saved before: links to it lead here.
		 */
		savedAs: uuid("saved_as"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("document_via_document_hash_idx").on(t.documentId, t.urlHash),
		index("document_via_user_hash_idx").on(t.userId, t.urlHash),
		index("document_via_saved_as_idx")
			.on(t.savedAs)
			.where(sql`${t.savedAs} is not null`),
	],
)
export type DocumentVia = typeof documentVia.$inferSelect

export const invites = pgTable("invites", {
	code: text("code").primaryKey(),
	/** Internal handle for admin URLs and audit entries, so logs never hold a usable code. */
	id: uuid("id")
		.notNull()
		.unique()
		.default(sql`gen_random_uuid()`),
	createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
	usedBy: text("used_by").references(() => user.id, { onDelete: "set null" }),
	usedAt: timestamp("used_at", { withTimezone: true }),
	expiresAt: timestamp("expires_at", { withTimezone: true }),
	note: text("note"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	/** Revoking also shortens `expiresAt`, which older code checks. */
	revokedAt: timestamp("revoked_at", { withTimezone: true }),
})

/**
 * The wait list (`SIGNUP_MODE=waitlist`): one pending request per address. Approving or dismissing
 * deletes the row; nothing is kept once a request is answered.
 */
export const inviteRequests = pgTable(
	"invite_requests",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		/** Lowercased. */
		email: text("email").notNull().unique(),
		note: text("note"),
		/** The language the invite email goes out in. */
		locale: text("locale").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		/** When the admins' daily digest counted it (apps/worker/src/jobs/invite-digest.ts). */
		notifiedAt: timestamp("notified_at", { withTimezone: true }),
	},
	(t) => [index("invite_requests_created_idx").on(t.createdAt.desc(), t.id.desc())],
)

/** Personal API keys (extension, iOS Shortcut, scripts). Only the sha256 of the key is stored. */
export const apiKeys = pgTable(
	"api_keys",
	{
		id: uuid("id").primaryKey().$defaultFn(newId),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		/** First characters of the key, for display ("klip_ab12…"). */
		prefix: text("prefix").notNull(),
		keyHash: text("key_hash").notNull(),
		lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
	},
	(t) => [
		uniqueIndex("api_keys_hash_unique").on(t.keyHash),
		index("api_keys_user_idx").on(t.userId),
	],
)

export type ApiKey = typeof apiKeys.$inferSelect

export const tags = pgTable(
	"tags",
	{
		id: uuid("id").primaryKey().$defaultFn(newId),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [uniqueIndex("tags_user_name_unique").on(t.userId, sql`lower(${t.name})`)],
)

export const documentTags = pgTable(
	"document_tags",
	{
		documentId: uuid("document_id")
			.notNull()
			.references(() => documents.id, { onDelete: "cascade" }),
		tagId: uuid("tag_id")
			.notNull()
			.references(() => tags.id, { onDelete: "cascade" }),
	},
	(t) => [
		primaryKey({ columns: [t.documentId, t.tagId] }),
		// The primary key leads with the article: this one finds the articles of a tag.
		index("document_tags_tag_idx").on(t.tagId),
	],
)

export type Tag = typeof tags.$inferSelect

/** A search query with a name, opened from the sidebar. The query is kept as typed. */
export const savedSearches = pgTable(
	"saved_searches",
	{
		id: uuid("id").primaryKey().$defaultFn(newId),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		query: text("query").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(t) => [uniqueIndex("saved_searches_user_name_unique").on(t.userId, sql`lower(${t.name})`)],
)

export type SavedSearch = typeof savedSearches.$inferSelect

/**
 * A feed (RSS, Atom, JSON Feed), shared: fetched once however many users follow it. The poller
 * fetches it when `nextFetchAt` comes, backing off while it keeps failing.
 */
export const feeds = pgTable(
	"feeds",
	{
		id: uuid("id").primaryKey().$defaultFn(newId),
		url: text("url").notNull(),
		urlHash: text("url_hash").notNull(),
		title: text("title"),
		siteUrl: text("site_url"),
		etag: text("etag"),
		lastModified: text("last_modified"),
		lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
		lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
		nextFetchAt: timestamp("next_fetch_at", { withTimezone: true }).notNull().defaultNow(),
		/** Consecutive failed fetches; 0 after a success. */
		errorCount: integer("error_count").notNull().default(0),
		lastError: text("last_error"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("feeds_url_hash_unique").on(t.urlHash),
		index("feeds_next_fetch_idx").on(t.nextFetchAt),
	],
)

/** A feed's entries, shared by its subscribers. Only what the list shows: no article content. */
export const feedItems = pgTable(
	"feed_items",
	{
		id: uuid("id").primaryKey().$defaultFn(newId),
		feedId: uuid("feed_id")
			.notNull()
			.references(() => feeds.id, { onDelete: "cascade" }),
		guid: text("guid").notNull(),
		url: text("url").notNull(),
		urlHash: text("url_hash").notNull(),
		title: text("title"),
		author: text("author"),
		excerpt: text("excerpt"),
		publishedAt: timestamp("published_at", { withTimezone: true }),
		firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
		/** Order in the list: the publish date, unless missing or later than when it was first seen. */
		sortAt: timestamp("sort_at", { withTimezone: true }).notNull().defaultNow(),
		/** Last fetch that listed it. Items the feed still lists are never purged (they would return). */
		lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("feed_items_feed_guid_unique").on(t.feedId, t.guid),
		index("feed_items_feed_sort_idx").on(t.feedId, t.sortAt.desc()),
	],
)

/** A user following a feed. */
export const subscriptions = pgTable(
	"subscriptions",
	{
		id: uuid("id").primaryKey().$defaultFn(newId),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		feedId: uuid("feed_id")
			.notNull()
			.references(() => feeds.id, { onDelete: "cascade" }),
		/** The user's name for it; the feed's own title when null. */
		title: text("title"),
		/**
		 * Items sorted before this stay hidden: subscribing shows the latest few, not the archive.
		 * Null while the feed has no items; the fetch that brings its first ones sets it.
		 */
		since: timestamp("since", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("subscriptions_user_feed_unique").on(t.userId, t.feedId),
		index("subscriptions_feed_idx").on(t.feedId),
	],
)

/** Feed items a user dismissed from their list. Saved ones need no row: they match a document. */
export const feedItemDismissals = pgTable(
	"feed_item_dismissals",
	{
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		itemId: uuid("item_id")
			.notNull()
			.references(() => feedItems.id, { onDelete: "cascade" }),
		dismissedAt: timestamp("dismissed_at", { withTimezone: true }).notNull().defaultNow(),
	},
	// The key leads with the user; the purge deletes items, and finds these by item.
	(t) => [
		primaryKey({ columns: [t.userId, t.itemId] }),
		index("feed_item_dismissals_item_idx").on(t.itemId),
	],
)

/** Posts explicitly opened, saved, or acknowledged by a user. Page visits do not create rows. */
export const feedItemViews = pgTable(
	"feed_item_views",
	{
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		itemId: uuid("item_id")
			.notNull()
			.references(() => feedItems.id, { onDelete: "cascade" }),
		viewedAt: timestamp("viewed_at", { withTimezone: true }).notNull().defaultNow(),
	},
	// The key leads with the user; the purge deletes items, and finds these by item.
	(t) => [
		primaryKey({ columns: [t.userId, t.itemId] }),
		index("feed_item_views_item_idx").on(t.itemId),
	],
)

export type Feed = typeof feeds.$inferSelect
export type FeedItem = typeof feedItems.$inferSelect
export type Subscription = typeof subscriptions.$inferSelect

/** An edition's picture for link previews: its articles as a stack of clippings, or on a shelf. */
export const editionCovers = ["stack", "shelf"] as const
export type EditionCover = (typeof editionCovers)[number]

/** Why someone reports a public edition, and the ground an admin removes one on. */
export const reportReasons = ["spam", "illegal", "copyright", "abuse", "other"] as const
export type ReportReason = (typeof reportReasons)[number]

/**
 * A page of articles the user found worth sharing. This row and its items are the working copy;
 * `published` is the snapshot the public page renders, and nothing else is.
 * State is derived: a draft until `published` is set, then live until `unpublishedAt` is. An
 * `updatedAt` later than the last (re)publish means unpublished changes.
 */
export const editions = pgTable(
	"editions",
	{
		id: uuid("id").primaryKey().$defaultFn(newId),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		/** In the public URL, unlike `id`. */
		publicId: text("public_id").notNull().$defaultFn(newPublicId),
		/** Optional: without one, the page shows its date as its title. */
		title: text("title"),
		intro: text("intro"),
		locale: text("locale").notNull(),
		/** Its picture for link previews; set in the working copy, shown once published. */
		cover: text("cover", { enum: editionCovers }).notNull().default("stack"),
		/** For the edition's dates: its own, and the day each article was read. */
		timeZone: text("time_zone").notNull(),
		/** Versioned (`v`): readers parse it instead of trusting this type. Null until published. */
		published: jsonb("published"),
		publishedAt: timestamp("published_at", { withTimezone: true }),
		republishedAt: timestamp("republished_at", { withTimezone: true }),
		unpublishedAt: timestamp("unpublished_at", { withTimezone: true }),
		/**
		 * Taken down by an admin after a report: unpublished, and the owner cannot publish it again
		 * until an admin restores it. The ground and the admin's note are what the owner was told.
		 */
		removedAt: timestamp("removed_at", { withTimezone: true }),
		removedGround: text("removed_ground", { enum: reportReasons }),
		removedNote: text("removed_note"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		/** Set by working-copy changes only, items included. No `$onUpdate`: publishing must not set it. */
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("editions_public_id_unique").on(t.publicId),
		index("editions_user_created_idx").on(t.userId, t.createdAt.desc()),
	],
)

/** A highlight as an edition item copies it. The quote is exact; the note is the edition's copy. */
export type EditionItemHighlight = {
	highlightId: string
	exact: string
	note: string | null
	startOffset: number
	included: boolean
}

/** An article in an edition, copied from the library so later library changes don't reach it. */
export const editionItems = pgTable(
	"edition_items",
	{
		id: uuid("id").primaryKey().$defaultFn(newId),
		editionId: uuid("edition_id")
			.notNull()
			.references(() => editions.id, { onDelete: "cascade" }),
		/** Null once the article is permanently deleted; the item stays. */
		documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
		/** The migration makes the unique constraint deferrable, so one statement can reorder. */
		position: integer("position").notNull(),
		url: text("url").notNull(),
		title: text("title").notNull(),
		author: text("author"),
		siteName: text("site_name"),
		description: text("description"),
		leadImageUrl: text("lead_image_url"),
		readingMinutes: integer("reading_minutes"),
		wordCount: integer("word_count"),
		readOn: date("read_on", { mode: "string" }),
		/** The edition's copy of the article note; null when the article had none. */
		note: text("note"),
		includeNote: boolean("include_note").notNull().default(false),
		highlights: jsonb("highlights").$type<EditionItemHighlight[]>().notNull().default([]),
		/**
		 * False when set aside: the item keeps its place and choices in the working copy, but the
		 * public page leaves it out, and publishing leaves its article on the shortlist.
		 */
		included: boolean("included").notNull().default(true),
	},
	(t) => [
		unique("edition_items_edition_position_unique").on(t.editionId, t.position),
		uniqueIndex("edition_items_edition_document_unique").on(t.editionId, t.documentId),
		// For the `set null` when an article is permanently deleted.
		index("edition_items_document_idx").on(t.documentId),
	],
)

export type Edition = typeof editions.$inferSelect
export type EditionItem = typeof editionItems.$inferSelect

/**
 * A visitor's report on a public edition, until an admin decides: then it is deleted, and the
 * audit keeps the decision without the reporter's text or address. The address is optional and
 * never verified; it gets one email, with the decision.
 */
export const editionReports = pgTable(
	"edition_reports",
	{
		id: uuid("id").primaryKey().$defaultFn(newId),
		editionId: uuid("edition_id")
			.notNull()
			.references(() => editions.id, { onDelete: "cascade" }),
		reason: text("reason", { enum: reportReasons }).notNull(),
		details: text("details").notNull(),
		email: text("email"),
		/** The reporter's language, for the decision's email. */
		locale: text("locale").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		/** When the admins' digest counted it. */
		notifiedAt: timestamp("notified_at", { withTimezone: true }),
	},
	(t) => [index("edition_reports_edition_idx").on(t.editionId, t.createdAt)],
)

export type EditionReport = typeof editionReports.$inferSelect

export const documentsRelations = relations(documents, ({ one, many }) => ({
	user: one(user, { fields: [documents.userId], references: [user.id] }),
	versions: many(documentVersions),
	highlights: many(highlights),
	currentVersion: one(documentVersions, {
		fields: [documents.currentVersionId],
		references: [documentVersions.id],
	}),
	leadImage: one(assets, { fields: [documents.leadImageAssetId], references: [assets.id] }),
	tags: many(documentTags),
}))

export const documentVersionsRelations = relations(documentVersions, ({ one }) => ({
	document: one(documents, { fields: [documentVersions.documentId], references: [documents.id] }),
	raw: one(documentRaw, { fields: [documentVersions.rawId], references: [documentRaw.id] }),
}))

export const highlightsRelations = relations(highlights, ({ one }) => ({
	document: one(documents, { fields: [highlights.documentId], references: [documents.id] }),
	version: one(documentVersions, {
		fields: [highlights.versionId],
		references: [documentVersions.id],
	}),
}))

export const documentTagsRelations = relations(documentTags, ({ one }) => ({
	document: one(documents, { fields: [documentTags.documentId], references: [documents.id] }),
	tag: one(tags, { fields: [documentTags.tagId], references: [tags.id] }),
}))

export type Document = typeof documents.$inferSelect
export type NewDocument = typeof documents.$inferInsert
export type DocumentVersion = typeof documentVersions.$inferSelect
export type DocumentRaw = typeof documentRaw.$inferSelect
export type Highlight = typeof highlights.$inferSelect
export type NewHighlight = typeof highlights.$inferInsert
export type Asset = typeof assets.$inferSelect
export type Invite = typeof invites.$inferSelect
