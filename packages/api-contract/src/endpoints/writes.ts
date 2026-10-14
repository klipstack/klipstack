import { z } from "zod"
import { defineEndpoint, empty, json, utf8Length } from "../endpoint"
import { HIGHLIGHT_COLORS } from "../enums"
import { NUL_REFUSED, URL_MAX, withoutNul } from "../names"
import {
	ArticleSummary,
	ArticleTitle,
	BATCH_MAX,
	EditionNote,
	FollowedFeed,
	HIGHLIGHT_NOTE_MAX,
	Highlight,
	HTML_MAX_BYTES,
	Id,
	Ids,
	NOTE_MAX,
	Note,
	QUOTE_MAX,
	Reading,
	SavedSearch,
	SavedSearchName,
	SavedSearchQuery,
	Tag,
	TagName,
	TagNames,
	Time,
} from "../schemas"

const Url = z.string().trim().min(1).max(URL_MAX)
const params = z.object({ id: Id })

export const saveArticle = defineEndpoint({
	id: "articles.save",
	method: "POST",
	path: "/articles",
	scope: "write",
	summary:
		"Saves a page to the library: 202 when new, 200 when the URL is already in the library (with html, it is extracted again).",
	// The page, plus what JSON escaping adds to it.
	bodyLimit: HTML_MAX_BYTES + 2 * 1024 * 1024,
	// Saving a URL again returns the same article (a capture is extracted again).
	retryOnCutoff: true,
	body: z.object({
		url: Url,
		/** The captured page (up to 10 MiB of UTF-8); the worker extracts it instead of fetching the URL. */
		html: z
			.string()
			.max(HTML_MAX_BYTES)
			.refine((html) => utf8Length(html) <= HTML_MAX_BYTES, {
				message: `The page may not exceed ${HTML_MAX_BYTES} bytes`,
			})
			.optional(),
		/** The capture-source label. */
		source: z.enum(["api", "extension"]).default("api"),
	}),
	response: json(z.object({ article: ArticleSummary, created: z.boolean() }), [202, 200]),
	errors: ["invalid_url", "unsupported_twitter", "unsupported_youtube", "limit_reached"],
})

export const updateArticles = defineEndpoint({
	id: "articles.update",
	method: "PATCH",
	path: "/articles",
	scope: "write",
	summary: `Moves, stars, marks for the next edition, finishes or tags up to ${BATCH_MAX} articles, in one transaction. shortlisted: true marks them for the user's next edition, and adds those with a web address to the draft edition in progress, if there is one; false takes them out of it. Publishing an edition with them clears the mark. finished: true also archives; finished: false marks them unread. addTags makes the tags that do not exist yet; names match whatever their case.`,
	body: z
		.object({
			ids: Ids,
			location: z.enum(["inbox", "archive"]).optional(),
			starred: z.boolean().optional(),
			shortlisted: z.boolean().optional(),
			finished: z.boolean().optional(),
			addTags: TagNames.optional(),
			/** A tag an article does not have is left alone. */
			removeTags: TagNames.optional(),
		})
		.refine(
			(v) =>
				v.location !== undefined ||
				v.starred !== undefined ||
				v.shortlisted !== undefined ||
				v.finished !== undefined ||
				v.addTags !== undefined ||
				v.removeTags !== undefined,
			{
				message:
					"Pass at least one of location, starred, shortlisted, finished, addTags and removeTags.",
			},
		)
		.refine((v) => !(v.finished === true && v.location === "inbox"), {
			message: "finished: true moves articles to the archive; they cannot also go to the library.",
			path: ["location"],
		}),
	response: json(
		z.object({
			items: z.array(ArticleSummary),
			notFound: z.array(Id),
			/**
			 * For `POST /articles/undo`: one token per request that changed something, none when nothing
			 * changed. Optional: servers before 2026-10-02 don't send it.
			 */
			undo: z.array(z.string()).optional(),
			/**
			 * The articles marking added to the draft edition in progress, and those unmarking took out
			 * of it, losing their copy there with its edits until the undo puts it back. Empty when the
			 * draft did not change or there is none. Optional: servers before 2026-10-11 don't send them.
			 */
			addedToDraft: z.array(Id).optional(),
			removedFromDraft: z.array(Id).optional(),
		}),
	),
	// An article would have more tags than it may, or the library more than it may: nothing changes.
	errors: ["too_many_article_tags", "too_many_tags"],
})

export const undoArticles = defineEndpoint({
	id: "articles.undo",
	method: "POST",
	path: "/articles/undo",
	scope: "write",
	summary:
		"Puts back what a PATCH /articles changed, with one of its undo tokens, for 15 minutes: the columns it wrote, the reading completions and tags it added, and the articles it added to or took out of the draft edition in progress.",
	body: z.object({
		token: z
			.string()
			.min(1)
			.max(64 * 1024),
	}),
	response: json(z.object({ items: z.array(ArticleSummary) })),
	// A token that is not this server's, not this user's, or too old is invalid_request.
	errors: [],
})

export const renameArticle = defineEndpoint({
	id: "articles.rename",
	method: "PATCH",
	path: "/articles/:id",
	scope: "write",
	summary: "Renames an article.",
	params,
	body: z.object({ title: ArticleTitle }),
	response: json(z.object({ article: ArticleSummary })),
	errors: ["not_found"],
})

export const trashArticles = defineEndpoint({
	id: "articles.trash",
	method: "POST",
	path: "/articles/trash",
	scope: "write",
	summary: `Moves up to ${BATCH_MAX} articles to the trash, restorable for 30 days.`,
	body: z.object({ ids: Ids }),
	response: json(
		z.object({
			trashed: z.array(Id),
			/** Not in the library, or already in the trash. */
			notFound: z.array(Id),
		}),
	),
	errors: [],
})

export const restoreArticles = defineEndpoint({
	id: "articles.restore",
	method: "POST",
	path: "/articles/restore",
	scope: "write",
	summary: `Takes up to ${BATCH_MAX} articles out of the trash.`,
	body: z.object({ ids: Ids }),
	response: json(
		z.object({
			restored: z.array(Id),
			/** Not in the trash. */
			notFound: z.array(Id),
			/** Not restored: the same URL was saved again since; `articleId` is that article. */
			alreadySaved: z.array(z.object({ id: Id, articleId: Id })),
		}),
	),
	errors: [],
})

export const openArticle = defineEndpoint({
	id: "articles.open",
	method: "POST",
	path: "/articles/:id/open",
	scope: "write",
	summary:
		"Records that the user is reading the article: it is no longer new. A finished inbox article opened again after 24 hours starts a new reading cycle. Call it once the user reads, not to preview.",
	params,
	response: json(Reading),
	errors: ["not_found"],
})

export const readPost = defineEndpoint({
	id: "articles.readPost",
	method: "POST",
	path: "/articles/:id/read-post",
	scope: "write",
	summary:
		"Reads the post an article was saved through instead of the article it shared (an entry of `via` with `restorable`): the article becomes the post again, extracted anew, and stays the post. `queued`: false when there is no such post.",
	params,
	response: json(z.object({ queued: z.boolean() })),
	errors: ["not_found"],
})

export const setPosition = defineEndpoint({
	id: "articles.setPosition",
	method: "PUT",
	path: "/articles/:id/position",
	scope: "write",
	summary:
		"Saves where the reader is, 0–1 of the article's height. Progress keeps the furthest point; from 0.95 the article counts as read (not finished). With `cycle`, a save from an earlier reading cycle changes nothing. With `listened`, the article was read aloud to this point: reaching the end counts as listened to.",
	params,
	body: z.object({
		position: z.number().min(0).max(1),
		/** `readingCycle` from the details, or `cycle` from `POST /articles/{id}/open`. */
		cycle: z.number().int().nonnegative().optional(),
		/** Read aloud to this point, rather than read. */
		listened: z.boolean().optional(),
	}),
	response: empty(),
	errors: ["not_found"],
})

export const setNote = defineEndpoint({
	id: "articles.setNote",
	method: "PUT",
	path: "/articles/:id/note",
	scope: "write",
	summary: "Replaces the article's note (null clears it), optionally only if it did not change.",
	params,
	body: z.object({
		note: z.string().max(NOTE_MAX).refine(withoutNul, NUL_REFUSED).nullable(),
		/** Omitted: no check. Null: the note must never have been saved. A time: the note's current noteUpdatedAt. */
		expectedUpdatedAt: Time.nullable().optional(),
	}),
	response: json(Note),
	errors: ["not_found", "note_changed"],
})

export const appendNote = defineEndpoint({
	id: "articles.appendNote",
	method: "POST",
	path: "/articles/:id/note/append",
	scope: "write",
	summary: "Adds a paragraph to the article's note.",
	params,
	body: z.object({ text: z.string().trim().min(1).max(NOTE_MAX).refine(withoutNul, NUL_REFUSED) }),
	response: json(Note),
	/** `note_too_long`: the note would exceed NOTE_MAX characters with the paragraph. */
	errors: ["not_found", "note_changed", "note_too_long"],
})

export const setEditionNote = defineEndpoint({
	id: "articles.setEditionNote",
	method: "PUT",
	path: "/articles/:id/edition-note",
	scope: "write",
	summary:
		"Replaces the article's note for the user's next edition (null or blank clears it): what the edition's readers see with the article, under the user's name. A draft edition with the article gets it too, unless its copy was changed there.",
	params,
	body: z.object({
		note: z.string().max(NOTE_MAX).refine(withoutNul, NUL_REFUSED).nullable(),
	}),
	response: json(EditionNote),
	errors: ["not_found"],
})

const Color = z.enum(HIGHLIGHT_COLORS)

export const createHighlight = defineEndpoint({
	id: "highlights.create",
	method: "POST",
	path: "/articles/:id/highlights",
	scope: "write",
	summary:
		"Highlights a passage by its text, or by its place. A passage that appears more than once needs `occurrence` or its place.",
	params,
	body: z.object({
		/** The passage as it reads in the article; Markdown symbols, whitespace, quote marks and case may differ. */
		quote: z.string().trim().min(1).max(QUOTE_MAX),
		/** 1 = first in reading order; see `409 ambiguous_quote`. */
		occurrence: z.number().int().min(1).optional(),
		/**
		 * Where the passage is, from a reader that shows `articles.html`: offsets into its text, and
		 * the text around it. When the text there is the quote, it is highlighted without searching,
		 * across paragraphs too; otherwise the quote is searched for, and the context picks among
		 * repeats.
		 */
		start: z.number().int().nonnegative().optional(),
		end: z.number().int().nonnegative().optional(),
		prefix: z.string().max(200).optional(),
		suffix: z.string().max(200).optional(),
		note: z.string().max(HIGHLIGHT_NOTE_MAX).refine(withoutNul, NUL_REFUSED).optional(),
		color: Color.optional(),
	}),
	response: json(z.object({ highlight: Highlight }), [201]),
	errors: ["not_found", "ambiguous_quote", "no_match", "not_ready"],
})

export const updateHighlight = defineEndpoint({
	id: "highlights.update",
	method: "PATCH",
	path: "/highlights/:id",
	scope: "write",
	summary: "Changes a highlight's note (null removes it) or color.",
	params,
	body: z
		.object({
			note: z
				.string()
				.max(HIGHLIGHT_NOTE_MAX)
				.refine(withoutNul, NUL_REFUSED)
				.nullable()
				.optional(),
			color: Color.optional(),
		})
		.refine((v) => v.note !== undefined || v.color !== undefined, {
			message: "Pass note or color.",
		}),
	response: json(z.object({ highlight: Highlight })),
	errors: ["not_found"],
})

/** A place in a version's text, as `articles.html` gives it: offsets, and the text between them. */
const Place = z.object({
	start: z.number().int().nonnegative(),
	end: z.number().int().nonnegative(),
	/** The text from `start` to `end`, exactly (whitespace included). */
	quote: z.string().min(1).max(QUOTE_MAX),
})

export const resizeHighlight = defineEndpoint({
	id: "highlights.resize",
	method: "PUT",
	path: "/highlights/:id/range",
	scope: "write",
	summary:
		"Moves a highlight's ends, in the text of the version a reader shows (`articles.html`): to take in more words, or fewer.",
	params,
	body: Place.extend({
		/** The version the offsets index (`articles.html`), which must still be the current one. */
		versionId: Id,
		/** The highlight's place as the client last read it: refused when it moved since. */
		previous: Place,
	}),
	response: json(z.object({ highlight: Highlight })),
	/**
	 * `version_changed`: the article was extracted again; `highlight_changed`: the highlight moved
	 * since `previous`; `invalid_range`: empty, or longer than QUOTE_MAX; `no_match`: the quote is
	 * not the text at those offsets.
	 */
	errors: ["not_found", "version_changed", "highlight_changed", "invalid_range", "no_match"],
})

export const deleteHighlight = defineEndpoint({
	id: "highlights.delete",
	method: "DELETE",
	path: "/highlights/:id",
	scope: "write",
	summary: "Deletes a highlight (the reader can restore it right after).",
	params,
	response: empty(),
	errors: ["not_found"],
})

export const createTag = defineEndpoint({
	id: "tags.create",
	method: "POST",
	path: "/tags",
	scope: "write",
	summary:
		"Makes a tag with no articles yet: 201 when new, 200 when the user has that name already, whatever its case. PATCH /articles with addTags makes the tags it needs, so this is only for setting names up first.",
	// The same name again answers with the same tag.
	retryOnCutoff: true,
	body: z.object({ name: TagName }),
	response: json(z.object({ tag: Tag, created: z.boolean() }), [201, 200]),
	// The library has as many tags as it may.
	errors: ["too_many_tags"],
})

export const renameTag = defineEndpoint({
	id: "tags.rename",
	method: "PATCH",
	path: "/tags/:id",
	scope: "write",
	summary:
		"Renames a tag. A name another tag has already (whatever its case) merges the two: that tag gets this one's articles, this one goes, and the answer has merged: true with the tag that stays.",
	params,
	body: z.object({ name: TagName }),
	response: json(z.object({ tag: Tag, merged: z.boolean() })),
	errors: ["not_found"],
})

export const deleteTag = defineEndpoint({
	id: "tags.delete",
	method: "DELETE",
	path: "/tags/:id",
	scope: "write",
	summary:
		"Deletes a tag. Its articles stay, without it. There is no undo. A tag that saved searches name is 409 tag_in_saved_searches, listing them: `force=true` deletes it anyway, and those searches then find nothing.",
	params,
	query: z.object({ force: z.stringbool().default(false) }),
	response: empty(),
	errors: ["not_found", "tag_in_saved_searches"],
})

export const createSavedSearch = defineEndpoint({
	id: "savedSearches.create",
	method: "POST",
	path: "/saved-searches",
	scope: "write",
	summary:
		"Saves a search query under a name; the app's sidebar lists it. The query is kept as written and parsed only when it is opened. A name is taken whatever its case; the same query may be saved under two names.",
	body: z.object({ name: SavedSearchName, query: SavedSearchQuery }),
	response: json(z.object({ savedSearch: SavedSearch }), [201]),
	errors: ["name_taken", "too_many_saved_searches"],
})

export const renameSavedSearch = defineEndpoint({
	id: "savedSearches.rename",
	method: "PATCH",
	path: "/saved-searches/:id",
	scope: "write",
	summary:
		"Renames a saved search. Its query does not change: save the new query and delete this one.",
	params,
	body: z.object({ name: SavedSearchName }),
	response: json(z.object({ savedSearch: SavedSearch })),
	errors: ["not_found", "name_taken"],
})

export const deleteSavedSearch = defineEndpoint({
	id: "savedSearches.delete",
	method: "DELETE",
	path: "/saved-searches/:id",
	scope: "write",
	summary: "Deletes a saved search. There is no undo.",
	params,
	response: empty(),
	errors: ["not_found"],
})

export const saveFeedItems = defineEndpoint({
	id: "feed.saveItems",
	method: "POST",
	path: "/feed/items/save",
	scope: "write",
	summary: `Saves up to ${BATCH_MAX} feed posts to the library.`,
	body: z.object({ ids: Ids }),
	response: json(
		z.object({
			saved: z.array(z.object({ itemId: Id, articleId: Id })),
			notFound: z.array(Id),
			/** Refused: the error `code` (`invalid_url`, `unsupported_*`, `rate_limited`, `limit_reached`…) and its message. */
			notSaved: z.array(z.object({ itemId: Id, code: z.string(), message: z.string() })),
		}),
	),
	errors: [],
})

export const dismissFeedItems = defineEndpoint({
	id: "feed.dismissItems",
	method: "POST",
	path: "/feed/items/dismiss",
	scope: "write",
	summary: `Hides up to ${BATCH_MAX} feed posts.`,
	body: z.object({ ids: Ids }),
	response: json(z.object({ dismissed: z.array(Id), notFound: z.array(Id) })),
	errors: [],
})

export const markFeedViewed = defineEndpoint({
	id: "feed.markViewed",
	method: "POST",
	path: "/feed/viewed",
	scope: "write",
	summary:
		"Explicitly acknowledges new posts available up to `asOf`. A future time counts as now. Do not call merely to list or visit Feed.",
	body: z.object({ asOf: Time }),
	response: json(z.object({ viewedAt: Time })),
	errors: [],
})

export const followFeed = defineEndpoint({
	id: "feeds.follow",
	method: "POST",
	path: "/feeds",
	scope: "write",
	summary:
		"Follows a feed, or the feed a site links: 201 when new, 200 when already followed. A site with several feeds gets 409 choose_feed.",
	body: z.object({ url: Url }),
	response: json(z.object({ feed: FollowedFeed, alreadyFollowing: z.boolean() }), [201, 200]),
	errors: ["choose_feed", "invalid_url", "not_feed", "fetch_failed", "limit_reached"],
})

export const unfollowFeed = defineEndpoint({
	id: "feeds.unfollow",
	method: "DELETE",
	path: "/feeds/:id",
	scope: "write",
	summary: "Stops following a feed. Articles saved from it stay.",
	params,
	response: empty(),
	errors: ["not_found"],
})
