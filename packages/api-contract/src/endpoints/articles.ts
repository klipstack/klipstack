import { z } from "zod"
import { defineEndpoint, json, text } from "../endpoint"
import { ARCHIVE_FILTERS, INBOX_FILTERS, LIST_FILTERS, LIST_SORTS, VIEWS } from "../enums"
import {
	ArticleDetails,
	ArticleSummary,
	ArticleTopics,
	BATCH_MAX,
	Id,
	LinkPreview,
	page,
} from "../schemas"
import { QUERY_MAX, SEARCH_LIMIT_MAX, SEARCH_OFFSET_MAX } from "../search-query"

const Cursor = z.string().max(500)

const filtersFor = (view: string): readonly string[] =>
	view === "inbox" ? INBOX_FILTERS : view === "trash" ? [] : ARCHIVE_FILTERS

export const listArticles = defineEndpoint({
	id: "articles.list",
	method: "GET",
	path: "/articles",
	scope: "read",
	summary:
		"Lists a view of the library, one page at a time: the library (`inbox`), the archive, starred, `all` (the library and the archive, newest saved first) or the trash.",
	query: z
		.object({
			view: z.enum(VIEWS).default("inbox"),
			/** Library: unread, progress, again (finished before and put back unread, not opened since), read, quick, long, x. Archive, starred and all: unfinished, finished, quick, long, x. Trash: none. */
			filter: z.enum(LIST_FILTERS).optional(),
			/** Defaults to recent for inbox/progress, newest otherwise. */
			sort: z.enum(LIST_SORTS).optional(),
			/** One of the user's topics (GET /topics), or `none`: sorted into no topic. Not in the trash. */
			topic: z.union([Id, z.literal("none")]).optional(),
			limit: z.coerce.number().int().min(1).max(100).default(20),
			cursor: Cursor.optional(),
		})
		.refine((q) => !q.filter || filtersFor(q.view).includes(q.filter), {
			message: `Library filters: ${INBOX_FILTERS.join(", ")}. Archive, starred and all filters: ${ARCHIVE_FILTERS.join(", ")}. The trash takes none.`,
			path: ["filter"],
		})
		.refine((q) => !q.topic || q.view !== "trash", {
			message: "The trash has no topics.",
			path: ["topic"],
		}),
	response: json(page(ArticleSummary)),
	/** `not_found`: `topic` is none of the user's topics now. */
	errors: ["not_found"],
})

export const searchArticles = defineEndpoint({
	id: "articles.search",
	method: "GET",
	path: "/search",
	scope: "read",
	summary:
		"Full-text search over the library, best matches first. `q` takes words and operators (`in:archive`, `is:starred`, `saved:7d`…); the trash is searched only with `in:trash` or `in:anywhere`.",
	query: z.object({
		q: z.string().trim().min(1).max(QUERY_MAX),
		limit: z.coerce.number().int().min(1).max(SEARCH_LIMIT_MAX).default(20),
		offset: z.coerce.number().int().min(0).max(SEARCH_OFFSET_MAX).default(0),
	}),
	response: json(
		z.object({
			items: z.array(ArticleSummary),
			/** `offset` of the next page; null on the last one. */
			nextOffset: z.number().int().nullable(),
			/** Operators in `q` that were not understood, as typed. They filtered nothing. */
			ignored: z.array(z.string()),
		}),
	),
	errors: [],
})

export const lookupArticles = defineEndpoint({
	id: "articles.lookup",
	method: "POST",
	path: "/articles/lookup",
	scope: "read",
	summary: "Finds saved articles by their original URLs, normalized as saving does.",
	body: z.object({ urls: z.array(z.string().trim().min(1).max(4096)).min(1).max(BATCH_MAX) }),
	response: json(
		z.object({
			/** One per distinct URL, in the order given; `id` is null when the URL is not saved (or only in the trash). */
			items: z.array(z.object({ url: z.string(), id: Id.nullable() })),
		}),
	),
	errors: [],
})

export const previewLink = defineEndpoint({
	id: "links.preview",
	method: "GET",
	path: "/links/preview",
	scope: "read",
	summary:
		"A web page's title, description, author, site name and picture, for a link card. Saves nothing. `preview` is null when the page can't be read. 30 a minute.",
	query: z.object({ url: z.string().trim().min(1).max(4096) }),
	response: json(z.object({ preview: LinkPreview.nullable() })),
	/** `invalid_url`: not an http(s) URL, or one with a user name or password. */
	errors: ["invalid_url"],
})

export const getArticle = defineEndpoint({
	id: "articles.get",
	method: "GET",
	path: "/articles/:id",
	scope: "read",
	summary: "An article's details: note, highlights, links and images. No text.",
	params: z.object({ id: Id }),
	response: json(ArticleDetails),
	errors: ["not_found"],
})

export const articleTopics = defineEndpoint({
	id: "articles.topics",
	method: "GET",
	path: "/articles/:id/topics",
	scope: "read",
	summary:
		"The automatic topics an article is in, strongest first, and a shelf of what to read next: unread articles of its strongest topic that has any, closest first. Ranked by the topic scores already stored; nothing is generated. Empty for accounts without topics.",
	params: z.object({ id: Id }),
	response: json(ArticleTopics),
	errors: ["not_found"],
})

export const articleMarkdown = defineEndpoint({
	id: "articles.markdown",
	method: "GET",
	path: "/articles/:id/markdown",
	scope: "read",
	summary: "The whole article as Markdown, with front matter, note and highlights.",
	params: z.object({ id: Id }),
	query: z.object({
		/** `stored` links the images Klipstack keeps to their absolute URLs; `original` keeps the site's. */
		images: z.enum(["stored", "original"]).default("stored"),
	}),
	response: text("text/markdown; charset=utf-8"),
	errors: ["not_found", "not_ready"],
})

export const articleHtml = defineEndpoint({
	id: "articles.html",
	method: "GET",
	path: "/articles/:id/html",
	scope: "read",
	summary: "The article's text as the reader shows it: the stored, sanitized HTML.",
	params: z.object({ id: Id }),
	response: json(
		z.object({
			/** The version the HTML is from. Highlight offsets index its text. */
			versionId: Id,
			/**
			 * The text node contents, in document order and joined, are the text that highlight
			 * offsets (`start`, `end`) index. Stored images are `<img src="/assets/<id>">`, relative
			 * to the server.
			 */
			html: z.string(),
		}),
	),
	errors: ["not_found", "not_ready"],
})
