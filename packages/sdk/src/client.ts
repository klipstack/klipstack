import {
	type EndpointId,
	type Endpoints,
	endpoints,
	type InputBody,
	type InputQuery,
	type TopicUse,
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
		/** How many articles each of a list's filters would show: the filter chips' counts. */
		counts: (query: QueryOf<"articles.counts"> = {}) => call("articles.counts", { query }),
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
		/** Archives every finished article in the library; `undo` puts them back, still finished. */
		archiveRead: () => call("articles.archiveRead"),
		rename: (id: string, title: string) =>
			call("articles.rename", { params: { id }, body: { title } }),
		trash: (ids: readonly string[]) =>
			batched(ids, (part) => call("articles.trash", { body: { ids: part } })),
		restore: (ids: readonly string[]) =>
			batched(ids, (part) => call("articles.restore", { body: { ids: part } })),
		/** Deletes articles in the trash for good; there is no undo. */
		purge: (ids: readonly string[]) =>
			batched(ids, (part) => call("articles.purge", { body: { ids: part } })),
		/** Tries a failed save again; `queued`: false when it had not failed. */
		retry: (id: string) => call("articles.retry", { params: { id } }),
		/** Records that the user is reading it; returns where the reading stands. */
		open: (id: string) => call("articles.open", { params: { id } }),
		/** Turns an article saved through a post back into the post (`via`, `restorable`). */
		readPost: (id: string) => call("articles.readPost", { params: { id } }),
		/** Saves where the reader is, 0–1; `cycle` from the details or `open`. */
		setPosition: (
			id: string,
			position: number,
			{ cycle, listened }: { cycle?: number; listened?: boolean } = {},
		) => call("articles.setPosition", { params: { id }, body: { position, cycle, listened } }),
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
		/** "Nothing to add": never asked for a note on it again. `unskipNote` undoes it. */
		skipNote: (id: string) => call("articles.skipNote", { params: { id } }),
		unskipNote: (id: string) => call("articles.unskipNote", { params: { id } }),
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
		/** Deletes it with its note; `restore` undoes it. */
		delete: (id: string) => call("highlights.delete", { params: { id } }),
		/** Brings a deleted highlight back, while its article is in the library. */
		restore: (id: string) => call("highlights.restore", { params: { id } }),
		/** Its public link: live, taken down (`removed`), or null when it is not shared. */
		getShare: (id: string) => call("highlights.getShare", { params: { id } }),
		/** Shares it at a public link, or updates what the page shows; same address. */
		share: (id: string, body: BodyOf<"highlights.share">) =>
			call("highlights.share", { params: { id }, body }),
		/** Takes its public page down. */
		stopSharing: (id: string) => call("highlights.stopSharing", { params: { id } }),
		/** It as a PNG to share, as a Response: wide or tall, with its note or without. */
		image: (id: string, query: QueryOf<"highlights.image"> = {}) =>
			call("highlights.image", { params: { id }, query }),
	}

	const noteLinks = {
		/** The original address of each article a note links to, by id. */
		lookup: (ids: string[]) => call("noteLinks.lookup", { body: { ids } }),
	}

	const notebook = {
		/**
		 * One page of the Notebook (By article by default). `view: "shuffle"` takes a `seed`; By
		 * article and Stream page with `cursor`.
		 */
		get: (query: QueryOf<"notebook.get"> = {}) => call("notebook.get", { query }),
	}

	const dailyHighlights = {
		/** The day's highlights for Home; `day` is the device's local date (YYYY-MM-DD). */
		list: (day: string) => call("dailyHighlights.list", { query: { day } }),
		/** "Not useful anymore": never brought back again. `restore` undoes it. */
		dismiss: (id: string) => call("dailyHighlights.dismiss", { params: { id } }),
		restore: (id: string) => call("dailyHighlights.restore", { params: { id } }),
	}

	const noteReminders = {
		/** Articles finished lately without a note, and whether Home asks about them now. */
		list: () => call("noteReminders.list"),
		/** "Not now": Home doesn't ask for a week. */
		snooze: () => call("noteReminders.snooze"),
	}

	const home = {
		/** What was finished in the past week; `timeZone` is the device's (an IANA name). */
		finished: (timeZone: string) => call("home.finished", { query: { timeZone } }),
		/** Unread saves from a while ago, in the day's order; with `topic`, that topic's. */
		rediscover: (query: QueryOf<"home.rediscover"> = {}) => call("home.rediscover", { query }),
	}

	const editions = {
		/** The next edition: the draft or the articles marked for it, and whether one is due. */
		next: () => call("editions.next"),
		/** "Not now" on the nudge for an edition: none for a week. */
		snoozeNudge: () => call("editions.snoozeNudge"),
	}

	const review = {
		/** Old saves never opened, the oldest first; keep them with `articles.update(ids, { kept: true })`. */
		list: () => call("review.list"),
		/** Whether Home suggests the review now. */
		suggested: () => call("review.suggested"),
		/** "Not now", or the review opened from Home: no suggestion for a month. */
		snooze: () => call("review.snooze"),
	}

	/** The guide and texts to start with, as the web's Discover page and empty Home show them. */
	const starterTexts = {
		/** Every one in `language` (the account's by default), the guide and a shelf per topic. */
		list: (language?: "en" | "es") => call("starterTexts.list", { query: { language } }),
		/** What Home offers with nothing to read: the guide while the reader is new, and a few texts. */
		offer: () => call("starterTexts.offer"),
		/** Adds one to the library, or finds the reader's copy (`created: false`): open `articleId`. */
		save: (slug: string) => call("starterTexts.save", { params: { slug } }),
	}

	type Language = { language?: "en" | "es"; signal?: AbortSignal }
	/**
	 * The AI about an article. Each question, follow-up, retry and new brief counts against the
	 * account's monthly cap. Answers arrive as events, as they are written: iterate them to the end.
	 * Only `status` is for every client: the rest answer only tokens issued to Klipstack's own apps
	 * with in-app AI (`IN_APP_AI_CLIENTS`); an API key, the CLI or another app gets `forbidden`.
	 */
	const ai = {
		/** Whether the account can ask, and this month's questions used against its cap. */
		status: () => call("ai.get"),
		/**
		 * Whether the account agrees that its questions and the article's text go to the AI provider,
		 * for every device (`consentedAt` in `status`).
		 */
		consent: (consented: boolean) => call("ai.consent", { body: { consented } }),
		/** The article's threads with their turns (its chat among them), and its brief. */
		article: (articleId: string) => call("ai.article", { params: { id: articleId } }),
		/** Explain, Define or Ask about a passage; `start` and `end` from `articles.html`'s text. */
		ask: (articleId: string, body: BodyOf<"ai.ask">, { signal }: { signal?: AbortSignal } = {}) =>
			call("ai.ask", { params: { id: articleId }, body, signal }),
		/** A question in the article's chat (the first one starts it). */
		chat: (articleId: string, question: string, { language, signal }: Language = {}) =>
			call("ai.chat", { params: { id: articleId }, body: { question, language }, signal }),
		followUp: (threadId: string, question: string, { language, signal }: Language = {}) =>
			call("ai.followUp", { params: { id: threadId }, body: { question, language }, signal }),
		/** Answers the last question again, in place of its answer. */
		retry: (threadId: string, { language, signal }: Language = {}) =>
			call("ai.retry", { params: { id: threadId }, body: { language }, signal }),
		/** Deletes a thread with its answers; `restore` undoes it. */
		delete: (threadId: string) => call("ai.delete", { params: { id: threadId } }),
		restore: (threadId: string) => call("ai.restore", { params: { id: threadId } }),
		/** The article's brief: the kept one at no cost (only a `brief` event), or a new one. */
		brief: (articleId: string, { language, signal }: Language = {}) =>
			call("ai.brief", { params: { id: articleId }, body: { language }, signal }),
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
		noteLinks,
		ai,
		notebook,
		dailyHighlights,
		noteReminders,
		home,
		editions,
		review,
		starterTexts,
		annotations: {
			/** Highlights and article notes with the words of `q`, grouped, with snippets. */
			search: (q: string, query: Omit<QueryOf<"annotations.search">, "q"> = {}) =>
				call("annotations.search", { query: { ...query, q } }),
		},
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
			/** Turns topics on: article text goes to the AI providers from now on. */
			enable: () => call("topics.enable"),
			/** Turns topics off and deletes them. There is no undo. */
			disable: () => call("topics.disable"),
			/** Confirms the first topics: those kept, each with a new name or none; the rest go. */
			confirm: (keep: { id: string; name?: string }[]) =>
				call("topics.confirm", { body: { keep } }),
			/** The first topics were opened: Home's card about them goes. */
			seen: () => call("topics.seen"),
			/** "Not now" on Home's card about the first topics. */
			dismissCard: () => call("topics.dismissCard"),
			/** "No thanks" on Home's invitation to turn topics on, or the offer seen: it ends for good. */
			endInvitation: () => call("topics.endInvitation"),
			/** Fails with `name_taken` when another topic has the name, whatever its case. */
			rename: (id: string, name: string) =>
				call("topics.rename", { params: { id }, body: { name } }),
			/** Its articles leave it, and it is never proposed again. There is no undo. */
			remove: (id: string) => call("topics.remove", { params: { id } }),
			/** Takes an article out of a topic for good: sorting never puts it back in it. */
			takeOut: (id: string, articleId: string) =>
				call("topics.takeOut", { params: { id, articleId } }),
			/** One more use of a part of topics, for the server's administrators. */
			countUse: (use: TopicUse) => call("topics.countUse", { body: { use } }),
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
		/** Where the account stands against each of its caps this month. */
		usage: () => call("usage.get"),
		account: {
			/**
			 * Deletes the account and everything in it, for good. `confirmEmail` must be its email.
			 * Only Klipstack's own apps may; it fails with `reauthentication_required` unless the token
			 * comes from a sign-in in the last 30 minutes.
			 */
			delete: (confirmEmail: string) => call("account.delete", { body: { confirmEmail } }),
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
	"articles.counts": "articles.counts",
	"articles.search": "articles.search",
	"annotations.search": "annotations.search",
	"articles.lookup": "articles.lookup",
	"links.preview": "links.preview",
	"articles.get": "articles.get",
	"articles.markdown": "articles.markdown",
	"articles.html": "articles.html",
	"articles.topics": "articles.topics",
	"articles.save": "articles.save",
	"articles.update": "articles.update",
	"articles.undo": "articles.undo",
	"articles.archiveRead": "articles.archiveRead",
	"articles.rename": "articles.rename",
	"articles.trash": "articles.trash",
	"articles.restore": "articles.restore",
	"articles.open": "articles.open",
	"articles.purge": "articles.purge",
	"articles.readPost": "articles.readPost",
	"articles.retry": "articles.retry",
	"articles.setPosition": "articles.setPosition",
	"articles.setNote": "articles.setNote",
	"articles.appendNote": "articles.appendNote",
	"articles.setEditionNote": "articles.setEditionNote",
	"articles.skipNote": "articles.skipNote",
	"articles.unskipNote": "articles.unskipNote",
	"assets.get": "assets.download",
	"highlights.list": "highlights.list",
	"highlights.create": "highlights.create",
	"highlights.update": "highlights.update",
	"highlights.resize": "highlights.resize",
	"highlights.delete": "highlights.delete",
	"highlights.restore": "highlights.restore",
	"highlights.getShare": "highlights.getShare",
	"highlights.share": "highlights.share",
	"highlights.stopSharing": "highlights.stopSharing",
	"highlights.image": "highlights.image",
	"noteLinks.lookup": "noteLinks.lookup",
	"notebook.get": "notebook.get",
	"dailyHighlights.list": "dailyHighlights.list",
	"dailyHighlights.dismiss": "dailyHighlights.dismiss",
	"dailyHighlights.restore": "dailyHighlights.restore",
	"noteReminders.list": "noteReminders.list",
	"noteReminders.snooze": "noteReminders.snooze",
	"home.finished": "home.finished",
	"home.rediscover": "home.rediscover",
	"editions.next": "editions.next",
	"editions.snoozeNudge": "editions.snoozeNudge",
	"review.list": "review.list",
	"review.suggested": "review.suggested",
	"review.snooze": "review.snooze",
	"starterTexts.list": "starterTexts.list",
	"starterTexts.offer": "starterTexts.offer",
	"starterTexts.save": "starterTexts.save",
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
	"topics.enable": "topics.enable",
	"topics.disable": "topics.disable",
	"topics.confirm": "topics.confirm",
	"topics.seen": "topics.seen",
	"topics.dismissCard": "topics.dismissCard",
	"topics.endInvitation": "topics.endInvitation",
	"topics.rename": "topics.rename",
	"topics.remove": "topics.remove",
	"topics.takeOut": "topics.takeOut",
	"topics.countUse": "topics.countUse",
	"savedSearches.list": "savedSearches.list",
	"savedSearches.create": "savedSearches.create",
	"savedSearches.rename": "savedSearches.rename",
	"savedSearches.delete": "savedSearches.delete",
	"export.get": "export",
	"openapi.get": "openapi",
	"ai.get": "ai.status",
	"ai.consent": "ai.consent",
	"ai.article": "ai.article",
	"ai.ask": "ai.ask",
	"ai.chat": "ai.chat",
	"ai.followUp": "ai.followUp",
	"ai.retry": "ai.retry",
	"ai.delete": "ai.delete",
	"ai.restore": "ai.restore",
	"ai.brief": "ai.brief",
	"usage.get": "usage",
	"account.delete": "account.delete",
}
