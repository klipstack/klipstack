import {
	type EndpointId,
	type Endpoints,
	endpoints,
	type InputBody,
	type InputQuery,
} from "@klipstack/api-contract"
import { type ClientOptions, createCaller } from "./call"
import { batched, paginate } from "./helpers"

type QueryOf<K extends EndpointId> = InputQuery<Endpoints[K]>
type BodyOf<K extends EndpointId> = InputBody<Endpoints[K]>

/**
 * The typed client our programs use. `call` is generic over the contract; the namespaced methods
 * are written by hand on top of it. `all` methods follow every page; methods that take ids or URLs
 * take any number and send them 50 at a time.
 */
export function createClient(options: ClientOptions) {
	const call = createCaller(endpoints, options)

	const articles = {
		/** One page of a view (inbox by default). */
		list: (query: QueryOf<"articles.list"> = {}) => call("articles.list", { query }),
		/** Every article of a view, page after page. */
		all: (query: Omit<QueryOf<"articles.list">, "cursor"> = {}) =>
			paginate((cursor) => call("articles.list", { query: { ...query, cursor } })),
		search: (q: string, query: Omit<QueryOf<"articles.search">, "q"> = {}) =>
			call("articles.search", { query: { ...query, q } }),
		/** Saved articles by original URL; `id` is null for URLs not in the library. */
		lookup: (urls: readonly string[]) =>
			batched(urls, (part) => call("articles.lookup", { body: { urls: part } }), "urls"),
		get: (id: string) => call("articles.get", { params: { id } }),
		/** The article as Markdown. */
		markdown: (id: string, query: QueryOf<"articles.markdown"> = {}) =>
			call("articles.markdown", { params: { id }, query }),
		/** The stored HTML the reader shows; highlight offsets index its text. */
		html: (id: string) => call("articles.html", { params: { id } }),
		/** Its automatic topics, and up to 3 unread articles of its strongest topic to read next. */
		topics: (id: string) => call("articles.topics", { params: { id } }),
		/** Saves a page; with `html`, the server extracts that capture instead of fetching the URL. */
		save: (body: BodyOf<"articles.save">) => call("articles.save", { body }),
		/** Moves, stars, finishes or tags (`addTags`, `removeTags`) any number of articles. */
		update: (ids: readonly string[], changes: Omit<BodyOf<"articles.update">, "ids">) =>
			batched(ids, (part) => call("articles.update", { body: { ...changes, ids: part } })),
		/** Puts back what `update` changed, with one of the tokens in its `undo`, for 15 minutes. */
		undo: (token: string) => call("articles.undo", { body: { token } }),
		rename: (id: string, title: string) =>
			call("articles.rename", { params: { id }, body: { title } }),
		trash: (ids: readonly string[]) =>
			batched(ids, (part) => call("articles.trash", { body: { ids: part } })),
		restore: (ids: readonly string[]) =>
			batched(ids, (part) => call("articles.restore", { body: { ids: part } })),
		/** Records that the user is reading it; returns where the reading stands. */
		open: (id: string) => call("articles.open", { params: { id } }),
		/** Turns an article saved through a post back into the post (`via`, `restorable`). */
		readPost: (id: string) => call("articles.readPost", { params: { id } }),
		/** Saves where the reader is, 0–1; `cycle` from the details or `open`. */
		setPosition: (id: string, position: number, { cycle }: { cycle?: number } = {}) =>
			call("articles.setPosition", { params: { id }, body: { position, cycle } }),
		/**
		 * Replaces the note (null clears it). With `expectedUpdatedAt` (the `noteUpdatedAt` read
		 * before, or null for a note never saved), a note changed meanwhile fails with `note_changed`.
		 */
		setNote: (
			id: string,
			note: string | null,
			{ expectedUpdatedAt }: { expectedUpdatedAt?: string | null } = {},
		) => call("articles.setNote", { params: { id }, body: { note, expectedUpdatedAt } }),
		appendNote: (id: string, text: string) =>
			call("articles.appendNote", { params: { id }, body: { text } }),
		/** Replaces the note for the user's next edition (null clears it). */
		setEditionNote: (id: string, note: string | null) =>
			call("articles.setEditionNote", { params: { id }, body: { note } }),
	}

	const links = {
		/** A web page's public metadata, for a link card; `preview` is null when unreadable. */
		preview: (url: string) => call("links.preview", { query: { url } }),
	}

	const highlights = {
		list: (query: QueryOf<"highlights.list"> = {}) => call("highlights.list", { query }),
		all: (query: Omit<QueryOf<"highlights.list">, "cursor"> = {}) =>
			paginate((cursor) => call("highlights.list", { query: { ...query, cursor } })),
		/** Highlights a passage by its text; a repeated passage fails with `ambiguous_quote`. */
		create: (articleId: string, body: BodyOf<"highlights.create">) =>
			call("highlights.create", { params: { id: articleId }, body }),
		update: (id: string, body: BodyOf<"highlights.update">) =>
			call("highlights.update", { params: { id }, body }),
		/** Moves its ends, in the text of the version `articles.html` gave (`versionId`). */
		resize: (id: string, body: BodyOf<"highlights.resize">) =>
			call("highlights.resize", { params: { id }, body }),
		delete: (id: string) => call("highlights.delete", { params: { id } }),
	}

	return {
		call,
		/** The account behind the token, and what the token may do. */
		me: () => call("me.get"),
		articles,
		assets: {
			/** A stored image as a streaming Response (check `headers.get("content-type")`). */
			download: (id: string) => call("assets.get", { params: { id } }),
		},
		links,
		highlights,
		feed: {
			get: (query: QueryOf<"feed.get"> = {}) => call("feed.get", { query }),
			/** Every post of one feed (with `newOnly`, the new ones not saved yet), page after page. */
			posts: (feed: string, query: Omit<QueryOf<"feed.get">, "feed" | "cursor"> = {}) =>
				paginate(async (cursor) => {
					const page = await call("feed.get", { query: { ...query, feed, cursor } })
					const section = page.feeds[0]
					return { items: section?.items ?? [], nextCursor: section?.nextCursor ?? null }
				}),
			saveItems: (ids: readonly string[]) =>
				batched(ids, (part) => call("feed.saveItems", { body: { ids: part } })),
			dismissItems: (ids: readonly string[]) =>
				batched(ids, (part) => call("feed.dismissItems", { body: { ids: part } })),
			/** Pass `listedAt` from `get`, so posts that arrived later stay new. */
			markViewed: (asOf: string) => call("feed.markViewed", { body: { asOf } }),
		},
		feeds: {
			list: () => call("feeds.list"),
			/** A site with several feeds fails with `choose_feed` (`details.choices`). */
			follow: (url: string) => call("feeds.follow", { body: { url } }),
			unfollow: (id: string) => call("feeds.unfollow", { params: { id } }),
		},
		tags: {
			/** Every tag with its article count. `articles.search("tag:<name>")` lists a tag's articles. */
			list: () => call("tags.list"),
			/** A tag with no articles yet; a name the user has already answers with that tag. */
			create: (name: string) => call("tags.create", { body: { name } }),
			/** A name another tag has already merges the two (`merged: true`, with the tag that stays). */
			rename: (id: string, name: string) => call("tags.rename", { params: { id }, body: { name } }),
			/**
			 * The articles stay, without the tag. A tag saved searches name is `409
			 * tag_in_saved_searches`, unless `force`.
			 */
			delete: (id: string, { force = false }: { force?: boolean } = {}) =>
				call("tags.delete", { params: { id }, query: { force } }),
		},
		topics: {
			/**
			 * The automatic topics, most articles first, and their `stage`; empty until it is `active`.
			 * `articles.list({ topic })` and `articles.search("topic:<name>")` list a topic's articles.
			 * With `view`: what each holds of that list, most first, and the list's `none` and `sorting`.
			 * With `latest`: each topic's newest articles, up to that many (16 at most).
			 */
			list: ({ view, latest }: { view?: "inbox" | "archive" | "starred"; latest?: number } = {}) =>
				call("topics.list", { query: { view, latest } }),
		},
		savedSearches: {
			/** The queries the user named, by name. `articles.search(query)` runs one. */
			list: () => call("savedSearches.list"),
			/** Fails with `name_taken` when another one has the name, whatever its case. */
			create: (name: string, query: string) =>
				call("savedSearches.create", { body: { name, query } }),
			/** The name only: to change the query, save the new one and delete this. */
			rename: (id: string, name: string) =>
				call("savedSearches.rename", { params: { id }, body: { name } }),
			delete: (id: string) => call("savedSearches.delete", { params: { id } }),
		},
		/** The whole library as a streaming Response: a zip (default) or JSON. */
		export: (format: "zip" | "json" = "zip") => call("export.get", { query: { format } }),
		/** The OpenAPI document (no token needed). */
		openapi: () => call("openapi.get"),
	}
}

export type KlipstackClient = ReturnType<typeof createClient>

/**
 * Where each endpoint lives on the client, as a dotted path. Typed over every endpoint id, so a
 * new endpoint without a facade method fails the typecheck; a test checks the paths resolve.
 */
export const FACADE: Record<EndpointId, string> = {
	"me.get": "me",
	"articles.list": "articles.list",
	"articles.search": "articles.search",
	"articles.lookup": "articles.lookup",
	"links.preview": "links.preview",
	"articles.get": "articles.get",
	"articles.markdown": "articles.markdown",
	"articles.html": "articles.html",
	"articles.topics": "articles.topics",
	"articles.save": "articles.save",
	"articles.update": "articles.update",
	"articles.undo": "articles.undo",
	"articles.rename": "articles.rename",
	"articles.trash": "articles.trash",
	"articles.restore": "articles.restore",
	"articles.open": "articles.open",
	"articles.readPost": "articles.readPost",
	"articles.setPosition": "articles.setPosition",
	"articles.setNote": "articles.setNote",
	"articles.appendNote": "articles.appendNote",
	"articles.setEditionNote": "articles.setEditionNote",
	"assets.get": "assets.download",
	"highlights.list": "highlights.list",
	"highlights.create": "highlights.create",
	"highlights.update": "highlights.update",
	"highlights.resize": "highlights.resize",
	"highlights.delete": "highlights.delete",
	"feed.get": "feed.get",
	"feed.saveItems": "feed.saveItems",
	"feed.dismissItems": "feed.dismissItems",
	"feed.markViewed": "feed.markViewed",
	"feeds.list": "feeds.list",
	"feeds.follow": "feeds.follow",
	"feeds.unfollow": "feeds.unfollow",
	"tags.list": "tags.list",
	"tags.create": "tags.create",
	"tags.rename": "tags.rename",
	"tags.delete": "tags.delete",
	"topics.list": "topics.list",
	"savedSearches.list": "savedSearches.list",
	"savedSearches.create": "savedSearches.create",
	"savedSearches.rename": "savedSearches.rename",
	"savedSearches.delete": "savedSearches.delete",
	"export.get": "export",
	"openapi.get": "openapi",
}
