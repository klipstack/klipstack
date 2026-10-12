import { z } from "zod"
import { HIGHLIGHT_COLORS } from "./enums"
import {
	ARTICLE_TITLE_MAX,
	cleanSavedSearchName,
	cleanTagName,
	cleanTopicName,
	NUL_REFUSED,
	SAVED_SEARCH_NAME_MAX,
	TAG_NAME_MAX,
	TOPIC_NAME_MAX,
	TAGS_PER_ARTICLE_MAX,
	withoutNul,
} from "./names"
import { QUERY_MAX } from "./search-query"

/**
 * Shared request and response schemas. Registered ids become `components/schemas` in the OpenAPI
 * document. Response schemas are plain objects without transforms: clients parse them with zod's
 * defaults, which drop unknown keys, so a new server field never breaks an older client.
 */

const OFFSET_HOURS = /([+-])(\d{2}):\d{2}$/

/**
 * Whether Postgres can store this ISO 8601 time: years 1–9999 (in UTC) and offsets up to ±15:59.
 * Anything else would fail in the database instead of in validation.
 */
export function isStorableTime(value: string): boolean {
	const ms = Date.parse(value)
	if (Number.isNaN(ms)) return false
	const year = new Date(ms).getUTCFullYear()
	if (year < 1 || year > 9999) return false
	const offset = OFFSET_HOURS.exec(value)
	return !offset || Number(offset[2]) <= 15
}

/** ISO 8601; the API writes UTC. */
export const Time = z.iso
	.datetime({ offset: true })
	.refine(isStorableTime, { message: "Time out of range" })
/** Any case in; lowercase out, as the database writes them, so ids compare as strings. */
export const Id = z.uuid().toLowerCase()

export { HIGHLIGHT_NOTE_MAX, NOTE_MAX, QUOTE_MAX } from "./names"
/** Longest quote a highlight can take, in characters. */
/** Largest captured page `POST /articles` takes, in UTF-8 bytes. */
export const HTML_MAX_BYTES = 10 * 1024 * 1024

/** Most items one batch change takes, everywhere: the API, MCP and the web app's bulk actions. */
export const BATCH_MAX = 100
export const Ids = z.array(Id).min(1).max(BATCH_MAX)

export const Me = z
	.object({
		id: z.string(),
		name: z.string(),
		email: z.string(),
		/** What the token may do: API keys always write; OAuth tokens need library:write. */
		access: z.enum(["read", "write"]),
		via: z.enum(["api_key", "oauth"]),
		/** The OAuth client, or null for an API key. */
		client: z.object({ id: z.string(), name: z.string() }).nullable(),
	})
	.meta({ id: "Me" })
export type Me = z.infer<typeof Me>

export const ARTICLE_STATUSES = ["queued", "processing", "ready", "failed"] as const

/**
 * Why an article could not be read. `http_error` comes with the site's status; `unknown` is a
 * failure on our side. More codes may come: treat unknown ones like `unknown`.
 */
export const FAILURE_CODES = [
	"http_error",
	"fetch_failed",
	"timeout",
	"blocked_host",
	"invalid_url",
	"not_html",
	"too_large",
	"too_many_redirects",
	"no_content",
	"unknown",
] as const

const articleSummaryShape = {
	id: Id,
	title: z.string().nullable(),
	author: z.string().nullable(),
	site: z.string().nullable(),
	description: z.string().nullable(),
	/** The original page. */
	url: z.string(),
	/** The article in the Klipstack reader. */
	readerUrl: z.string(),
	savedAt: Time,
	publishedAt: Time.nullable(),
	location: z.enum(["inbox", "archive"]),
	archivedAt: Time.nullable(),
	starred: z.boolean(),
	/** Marked for the user's next edition, the public page of articles they share. */
	shortlisted: z.boolean(),
	/** Ever opened in the reader. */
	opened: z.boolean(),
	/** How far it was read, 0–1. */
	progress: z.number(),
	finished: z.boolean(),
	finishedAt: Time.nullable(),
	readingMinutes: z.number().int().nullable(),
	status: z.enum(ARTICLE_STATUSES),
	/**
	 * Why it could not be read, while `status` is `failed`; null otherwise. Saving the URL again
	 * (`POST /articles`) tries again.
	 */
	failure: z
		.object({
			/** One of `FAILURE_CODES`, or a newer one. */
			code: z.string(),
			/** The site's HTTP status, for `http_error`. */
			httpStatus: z.number().int().nullable(),
		})
		.nullable(),
	/** When it went to the trash; null outside the trash. */
	trashedAt: Time.nullable(),
	/** Tag names, by name. */
	tags: z.array(z.string()),
	/**
	 * The picture the library shows for the article; null when it has none. `url` is for browsers:
	 * the stored copy (`<APP_URL>/assets/<id>`, which needs the web session) or, when none was
	 * stored, the site's own image. `downloadUrl` is set for a stored copy and takes the bearer token
	 * (`GET /assets/{id}`). Optional because servers before 2026-09-25 don't send it: a missing one
	 * reads as null.
	 */
	leadImage: z
		.object({ url: z.string(), downloadUrl: z.string().nullable() })
		.nullable()
		.optional(),
}

export const ArticleSummary = z.object(articleSummaryShape).meta({ id: "ArticleSummary" })
export type ArticleSummary = z.infer<typeof ArticleSummary>

export const TOPIC_NAME_REFUSED = `A topic name has 1 to ${TOPIC_NAME_MAX} characters.`

/** A topic name as the reader writes it. It is stored trimmed, with inner whitespace as one space. */
export const TopicName = z
	.string()
	.max(200)
	.refine((name) => cleanTopicName(name) !== null, { message: TOPIC_NAME_REFUSED })

export const TAG_NAME_REFUSED = `A tag name has 1 to ${TAG_NAME_MAX} characters, and no double quote, comma or NUL.`

/** A tag name as clients write it. It is stored trimmed, with inner whitespace as one space. */
export const TagName = z
	.string()
	.max(200)
	.refine((name) => cleanTagName(name) !== null, { message: TAG_NAME_REFUSED })

/** Tags to add to or take off articles in one change. */
export const TagNames = z.array(TagName).min(1).max(TAGS_PER_ARTICLE_MAX)

export const ArticleTitle = z
	.string()
	.trim()
	.min(1)
	.max(ARTICLE_TITLE_MAX)
	.refine(withoutNul, NUL_REFUSED)

export const Tag = z
	.object({
		id: Id,
		name: z.string(),
		/** Articles with the tag, the trash left out. A tag outlives its articles: it may be 0. */
		articles: z.number().int(),
	})
	.meta({ id: "Tag" })
export type Tag = z.infer<typeof Tag>

export const Topic = z
	.object({
		id: Id,
		name: z.string(),
		/** What the topic holds, in the reader's words. */
		description: z.string(),
		/** Articles in it, the trash left out. */
		articles: z.number().int(),
		/** With `view`: its articles in that list. */
		inView: z.number().int().optional(),
	})
	.meta({ id: "Topic" })
export type Topic = z.infer<typeof Topic>

/** A saved search's name as clients write it. It is stored trimmed, with inner whitespace as one space. */
export const SavedSearchName = z
	.string()
	.max(200)
	.refine((name) => cleanSavedSearchName(name) !== null, {
		message: `A saved search's name has 1 to ${SAVED_SEARCH_NAME_MAX} characters, and no NUL.`,
	})

/** A query as the search page takes it. It is stored as written, without the space around it. */
export const SavedSearchQuery = z
	.string()
	.max(QUERY_MAX * 2)
	.refine((q) => q.trim() !== "" && q.trim().length <= QUERY_MAX && withoutNul(q), {
		message: `A saved search's query has 1 to ${QUERY_MAX} characters, and no NUL.`,
	})

export const SavedSearch = z
	.object({
		id: Id,
		name: z.string(),
		/** What GET /search takes as `q`. */
		query: z.string(),
	})
	.meta({ id: "SavedSearch" })
export type SavedSearch = z.infer<typeof SavedSearch>

export const HighlightArticle = z.object({
	id: Id,
	title: z.string().nullable(),
	site: z.string().nullable(),
	url: z.string(),
})

export const Highlight = z
	.object({
		id: Id,
		quote: z.string(),
		note: z.string().nullable(),
		color: z.enum(HIGHLIGHT_COLORS),
		createdAt: Time,
		article: HighlightArticle,
		/**
		 * The article's text just before and after the passage (up to 32 characters each), to find
		 * the right place when the quote appears more than once. Optional because servers before
		 * 2026-09-25 don't send them.
		 */
		prefix: z.string().optional(),
		suffix: z.string().optional(),
		/**
		 * Where the passage is: offsets into the text of an article version (its HTML's text nodes,
		 * joined; see `articles.html`). `articles.get` moves them to the current version first;
		 * `highlights.list` may give an older one's. A highlight a re-extraction lost keeps its old
		 * offsets: check that the text there is the quote.
		 */
		start: z.number().int().nonnegative(),
		end: z.number().int().nonnegative(),
	})
	.meta({ id: "Highlight" })
export type Highlight = z.infer<typeof Highlight>

export const ArticleImage = z
	.object({
		/** Stored images in reading order, numbered as MCP numbers them. */
		number: z.number().int().min(1),
		/** The asset id. */
		id: Id,
		alt: z.string(),
		caption: z.string(),
		/** Null when unknown; width, height and bytes are all null when the stored copy is gone. */
		width: z.number().int().nullable(),
		height: z.number().int().nullable(),
		bytes: z.number().int().nullable(),
		/** `<origin>/assets/<id>`: opens in a signed-in browser. */
		url: z.string(),
		/** `<origin>/api/v1/assets/<id>`: for programs, with a token. */
		downloadUrl: z.string(),
	})
	.meta({ id: "ArticleImage" })
export type ArticleImage = z.infer<typeof ArticleImage>

/** Where a link sits: the note of the article itself (null), or one of its highlights' notes. */
const LinkHighlight = z.object({ id: Id, quote: z.string().nullable() }).nullable()

/** A link the user wrote in a note, to another article. */
export const NoteLinkTo = z
	.object({
		id: Id,
		/** The link text. */
		title: z.string(),
		/** `trash`: the target is in the trash; `missing`: it is gone. */
		status: z.enum(["ok", "trash", "missing"]),
		/** The target's original page; null when it is gone. */
		url: z.string().nullable(),
		readerUrl: z.string(),
		highlight: LinkHighlight,
	})
	.meta({ id: "NoteLinkTo" })
export type NoteLinkTo = z.infer<typeof NoteLinkTo>

/** An article with a note that links here. */
export const NoteLinkFrom = z
	.object({
		id: Id,
		title: z.string().nullable(),
		url: z.string(),
		readerUrl: z.string(),
		highlight: LinkHighlight,
	})
	.meta({ id: "NoteLinkFrom" })
export type NoteLinkFrom = z.infer<typeof NoteLinkFrom>

/** A library article at the other end of a link in an article's content. */
export const ContentLink = z
	.object({
		id: Id,
		title: z.string().nullable(),
		url: z.string(),
		readerUrl: z.string(),
	})
	.meta({ id: "ContentLink" })
export type ContentLink = z.infer<typeof ContentLink>

/** A post the article was saved through: it only passed the article's link along. */
export const SharedVia = z
	.object({
		id: Id,
		/** The post. */
		url: z.string(),
		author: z.string().nullable(),
		siteName: z.string().nullable(),
		/** The post's text, sanitized, with its links and without its pictures. */
		html: z.string(),
		publishedAt: Time.nullable(),
		/** `POST /articles/{id}/read-post` turns the article back into this post. */
		restorable: z.boolean(),
	})
	.meta({ id: "SharedVia" })
export type SharedVia = z.infer<typeof SharedVia>

export const ArticleDetails = z
	.object({
		...articleSummaryShape,
		note: z.string().nullable(),
		/** Null until the note is first saved; pass it back as `expectedUpdatedAt`. */
		noteUpdatedAt: Time.nullable(),
		/**
		 * What the user wrote for the readers of their next edition: unlike `note`, for others to read,
		 * under the user's name. Null when none. Optional because servers before 2026-10-11 don't send
		 * it.
		 */
		editionNote: z.string().nullable().optional(),
		/**
		 * Where the reader last was, 0–1 (`progress` is the furthest point). Optional, with
		 * `readingCycle`, because servers before 2026-09-26 don't send them.
		 */
		position: z.number().optional(),
		/** Pass it back with `PUT /articles/{id}/position`. */
		readingCycle: z.number().int().optional(),
		/**
		 * The language of the article's text as extraction found it (`en`, `es`, …); null when
		 * unknown. Optional because servers before 2026-09-26 don't send it.
		 */
		language: z.string().nullable().optional(),
		/** In reading order. */
		highlights: z.array(Highlight),
		/**
		 * Links the user wrote in notes. `to`: what this article's notes (its own and its
		 * highlights') link to. `from`: the articles whose notes link to this one.
		 */
		noteLinks: z.object({ to: z.array(NoteLinkTo), from: z.array(NoteLinkFrom) }),
		/**
		 * Links the authors wrote in the articles' content, between articles of the library. `to`:
		 * library articles this one's content links to. `from`: the ones whose content links here.
		 */
		contentLinks: z.object({ to: z.array(ContentLink), from: z.array(ContentLink) }),
		/**
		 * The short posts the article was saved through, oldest first: saving a post that only
		 * shares a link saves the linked article. Optional because servers before 2026-10-04 don't
		 * send it.
		 */
		via: z.array(SharedVia).optional(),
		images: z.array(ArticleImage),
		/** Images that only link to the original site. */
		notStoredImages: z.number().int(),
		/** The worker is still storing this article's images. */
		imagesPending: z.boolean(),
	})
	.meta({ id: "ArticleDetails" })
export type ArticleDetails = z.infer<typeof ArticleDetails>

/** A topic an article is in: one of the user's automatic topics, as its web page names it. */
export const ArticleTopic = z.object({ id: Id, name: z.string() }).meta({ id: "ArticleTopic" })

/**
 * An article's topics, and what to read next in them. Empty (no topics, no shelf) for accounts
 * without topics, and on servers without topic models.
 */
export const ArticleTopics = z
	.object({
		/** The topics the article is in, strongest first. Not suggested or refused ones. */
		topics: z.array(ArticleTopic),
		/**
		 * Up to 3 unread articles (not finished, archived or trashed, and ready) of the article's
		 * strongest topic that has any, closest to this one first, then newest. Articles in progress
		 * count as unread. Null when none of its topics has one.
		 */
		shelf: z
			.object({
				topic: ArticleTopic,
				/** How many unread articles the topic holds, besides this one. */
				unread: z.number().int(),
				items: z.array(
					z.object({
						id: Id,
						title: z.string().nullable(),
						siteName: z.string().nullable(),
						url: z.string(),
						readingMinutes: z.number().int().nullable(),
						readerUrl: z.string(),
					}),
				),
			})
			.nullable(),
	})
	.meta({ id: "ArticleTopics" })
export type ArticleTopics = z.infer<typeof ArticleTopics>

export const FeedPost = z
	.object({
		id: Id,
		title: z.string().nullable(),
		url: z.string(),
		author: z.string().nullable(),
		excerpt: z.string().nullable(),
		publishedAt: Time.nullable(),
		/** Available to this user for less than 14 days and not opened, saved, or acknowledged. */
		new: z.boolean(),
		/** The article, once the post's link is in the library. */
		savedArticleId: Id.nullable(),
	})
	.meta({ id: "FeedPost" })
export type FeedPost = z.infer<typeof FeedPost>

const feedShape = {
	/** The subscription id. */
	id: Id,
	title: z.string(),
	siteUrl: z.string(),
	/** The feed failed to update several times in a row. */
	notUpdating: z.boolean(),
}

export const QuietFeed = z.object(feedShape).meta({ id: "QuietFeed" })
export type QuietFeed = z.infer<typeof QuietFeed>

export const FeedSection = z
	.object({
		...feedShape,
		/** New posts not saved yet. */
		newCount: z.number().int(),
		items: z.array(FeedPost),
		/** Posts after these that match the same filters. */
		moreItems: z.number().int(),
		/** Pass it as `cursor` for this feed's next posts; null when there are none. */
		nextCursor: z.string().nullable(),
	})
	.meta({ id: "FeedSection" })
export type FeedSection = z.infer<typeof FeedSection>

export const FeedPage = z
	.object({
		/** Optional cutoff for explicit bulk acknowledgement with `POST /feed/viewed`. */
		listedAt: Time,
		feeds: z.array(FeedSection),
		/** Followed feeds with nothing to show. */
		quietFeeds: z.array(QuietFeed),
	})
	.meta({ id: "FeedPage" })
export type FeedPage = z.infer<typeof FeedPage>

export const FollowedFeed = z
	.object({ ...feedShape, newCount: z.number().int() })
	.meta({ id: "FollowedFeed" })
export type FollowedFeed = z.infer<typeof FollowedFeed>

export const page = <T extends z.ZodType>(item: T) =>
	z.object({ items: z.array(item), nextCursor: z.string().nullable() })

/** A web page's public metadata, for a link card; opening a preview saves nothing. */
export const LinkPreview = z
	.object({
		title: z.string().nullable(),
		description: z.string().nullable(),
		author: z.string().nullable(),
		/** The site's own name ("Wikipedia"); null when the page has none: show its host. */
		siteName: z.string().nullable(),
		/** The page's picture, on its site; load it without credentials. */
		imageUrl: z.string().nullable(),
	})
	.meta({ id: "LinkPreview" })
export type LinkPreview = z.infer<typeof LinkPreview>

/** Where the reading of an article stands. */
export const Reading = z
	.object({
		/** How far it was read, 0–1: the furthest point. */
		progress: z.number(),
		/** Where the reader last was, 0–1. */
		position: z.number(),
		/**
		 * The reading cycle: it goes up when a finished article is read again. Pass it back with
		 * `PUT /articles/{id}/position`, so a late save from the reading before is ignored.
		 */
		cycle: z.number().int(),
	})
	.meta({ id: "Reading" })
export type Reading = z.infer<typeof Reading>

export const EditionNote = z
	.object({
		/** Null when none. */
		editionNote: z.string().nullable(),
	})
	.meta({ id: "EditionNote" })
export type EditionNote = z.infer<typeof EditionNote>

export const Note = z
	.object({
		note: z.string().nullable(),
		/** Pass it back as `expectedUpdatedAt` to save only if nobody changed the note meanwhile. */
		noteUpdatedAt: Time.nullable(),
	})
	.meta({ id: "Note" })
export type Note = z.infer<typeof Note>
