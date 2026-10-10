import { z } from "zod"
import { binary, defineEndpoint, json } from "../endpoint"
import { HIGHLIGHT_FILTERS } from "../enums"
import { FeedPage, FollowedFeed, Highlight, Id, page, SavedSearch, Tag } from "../schemas"

export const getAsset = defineEndpoint({
	id: "assets.get",
	method: "GET",
	path: "/assets/:id",
	scope: "read",
	summary: "A stored image, as stored, with its content type and ETag.",
	params: z.object({ id: Id }),
	response: binary(),
	errors: ["not_found"],
})

export const listHighlights = defineEndpoint({
	id: "highlights.list",
	method: "GET",
	path: "/highlights",
	scope: "read",
	summary: "Highlights, newest first: all of them, or one article's.",
	query: z.object({
		article: Id.optional(),
		/** `notes`: only highlights with a note; or a color. */
		filter: z.enum(HIGHLIGHT_FILTERS).optional(),
		/** Words or "quoted phrases" in the quote, the note, or the article's title, author or site. */
		q: z.string().trim().max(200).optional(),
		limit: z.coerce.number().int().min(1).max(100).default(50),
		cursor: z.string().max(500).optional(),
	}),
	response: json(page(Highlight)),
	errors: ["not_found"],
})

export const getFeed = defineEndpoint({
	id: "feed.get",
	method: "GET",
	path: "/feed",
	scope: "read",
	summary: "The feed page: followed feeds with their posts, newest activity first.",
	query: z.object({
		/** Only new posts that are not saved yet; feeds without any are left out. */
		newOnly: z.stringbool().default(false),
		/** Only this feed (a subscription id). */
		feed: Id.optional(),
		perFeed: z.coerce.number().int().min(1).max(50).default(10),
		/** A feed's `nextCursor`: that feed's next posts, with the same `newOnly`. */
		cursor: z.string().optional(),
	}),
	response: json(FeedPage),
	errors: [],
})

export const listFeeds = defineEndpoint({
	id: "feeds.list",
	method: "GET",
	path: "/feeds",
	scope: "read",
	summary: "Every followed feed, quiet ones included, by title.",
	response: json(z.object({ items: z.array(FollowedFeed) })),
	errors: [],
})

export const listTags = defineEndpoint({
	id: "tags.list",
	method: "GET",
	path: "/tags",
	scope: "read",
	summary:
		"Every tag, by name, with how many articles have it. Search with tag:<name> for the articles; PATCH /articles puts tags on articles and takes them off.",
	response: json(z.object({ items: z.array(Tag) })),
	errors: [],
})

export const listSavedSearches = defineEndpoint({
	id: "savedSearches.list",
	method: "GET",
	path: "/saved-searches",
	scope: "read",
	summary:
		"Every saved search, by name: the queries the user named, which the app's sidebar opens. Run one with GET /search?q=<query>.",
	response: json(z.object({ items: z.array(SavedSearch) })),
	errors: [],
})

export const exportLibrary = defineEndpoint({
	id: "export.get",
	method: "GET",
	path: "/export",
	scope: "read",
	summary: "The whole library, as Settings exports it: a zip of Markdown and JSON, or JSON.",
	query: z.object({ format: z.enum(["zip", "json"]).default("zip") }),
	response: binary(),
	errors: [],
})
