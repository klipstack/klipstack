import { z } from "zod"
import { defineEndpoint, empty, json } from "../endpoint"
import { HIGHLIGHT_COLORS, NOTEBOOK_FILTERS, NOTEBOOK_VIEWS } from "../enums"
import { Highlight, HighlightArticle, Id, Time } from "../schemas"
import { QUERY_MAX } from "../search-query"

/**
 * What a reader kept from what they read: the Notebook (highlights and article notes together),
 * the few highlights Home brings back each day, and searching both. Only the user's own: never a
 * deleted highlight, nor anything of an article in the trash.
 */

const params = z.object({ id: Id })

/** A Shuffle hand's seed: the same seed deals the same hand. */
export const NOTEBOOK_SEED = /^[a-z0-9]{1,16}$/

/** Articles (By article) or cards (Stream) a Notebook page holds at most. */
export const NOTEBOOK_LIMIT_MAX = 50

/**
 * The articles a note's links point to that are still there, by id: `trash` when in the trash.
 * An id left out is gone.
 */
const LinkTargets = z.record(z.string(), z.enum(["ok", "trash"]))

/** What the Notebook shows of an article, beside what was kept from it. */
export const NotebookArticle = z
	.object({
		id: Id,
		title: z.string().nullable(),
		author: z.string().nullable(),
		site: z.string().nullable(),
		url: z.string(),
		readerUrl: z.string(),
		/** As `ArticleSummary.leadImage`: `downloadUrl` takes the bearer token. */
		leadImage: z.object({ url: z.string(), downloadUrl: z.string().nullable() }).nullable(),
	})
	.meta({ id: "NotebookArticle" })
export type NotebookArticle = z.infer<typeof NotebookArticle>

/** A card: a highlight (with its note), or an article's note. */
export const NotebookItem = z
	.discriminatedUnion("kind", [
		z.object({ kind: z.literal("highlight"), highlight: Highlight, article: NotebookArticle }),
		z.object({
			kind: z.literal("note"),
			note: z.string(),
			/** What a save sends back as `expectedUpdatedAt` (PUT /articles/{id}/note). */
			noteUpdatedAt: Time.nullable(),
			/** When it was last written; for a note never saved here (an import), when the article was saved. */
			writtenAt: Time,
			/**
			 * False when an earlier topic group shows the same note (By topic): write on it there.
			 * Always true in the other views.
			 */
			editable: z.boolean(),
			article: NotebookArticle,
		}),
	])
	.meta({ id: "NotebookItem" })
export type NotebookItem = z.infer<typeof NotebookItem>

const counts = Object.fromEntries(
	["all", ...NOTEBOOK_FILTERS].map((k) => [k, z.number().int()]),
) as Record<"all" | (typeof NOTEBOOK_FILTERS)[number], z.ZodNumber>

const NotebookBase = {
	/** What each filter would show, with the search, tag and topic applied: the filter chips. */
	counts: z.object(counts),
	/** The user's tags whose live articles have highlights or a note, by name: the tag menu. */
	tags: z.array(z.object({ id: Id, name: z.string(), count: z.number().int() })),
	/** Whether the reader's topics are in use: By topic and `topic` need them. */
	topicsInUse: z.boolean(),
	/** The topic the page narrows to (`topic`); `id` and `name` are null for `none`. */
	topic: z.object({ id: Id.nullable(), name: z.string().nullable() }).nullable(),
	linkTargets: LinkTargets,
}

export const getNotebook = defineEndpoint({
	id: "notebook.get",
	method: "GET",
	path: "/notebook",
	scope: "read",
	summary:
		"The Notebook: highlights and article notes together, as the web app's /notebook shows them. By article (`articles`: by latest activity, each with its note and every matching highlight in reading order), as one stream (`stream`: newest first), by topic (`topics`: each topic's newest few and its counts; the rest are the stream with `topic`) or a random hand (`shuffle`, with a `seed`). `view=topics` while topics are not in use answers By article: the answer's `view` says which. A search, a filter, a tag and a topic narrow every view.",
	query: z
		.object({
			view: z.enum(NOTEBOOK_VIEWS).default("articles"),
			/** Words or "quoted phrases" in a highlight's quote, note or article, or in an article's note. */
			q: z.string().trim().max(QUERY_MAX).optional(),
			/** `notes`: article notes and highlights with a note; `highlights`: highlights only; or a color. */
			filter: z.enum(NOTEBOOK_FILTERS).optional(),
			/** One of the user's tags (GET /tags): only what was kept from articles with it. */
			tag: Id.optional(),
			/** One of the user's topics (GET /topics), or `none`. Not with `view=topics`. */
			topic: z.union([Id, z.literal("none")]).optional(),
			/** Shuffle's hand: the same seed deals the same cards; a new one deals again. */
			seed: z.string().regex(NOTEBOOK_SEED).optional(),
			/** Articles (By article, 20 by default) or cards (Stream, 50 by default) a page holds. */
			limit: z.coerce.number().int().min(1).max(NOTEBOOK_LIMIT_MAX).optional(),
			cursor: z.string().max(500).optional(),
		})
		.refine((q) => (q.view === "shuffle") === (q.seed !== undefined), {
			message: "Shuffle takes a seed, and only Shuffle does.",
			path: ["seed"],
		})
		.refine((q) => !q.topic || q.view !== "topics", {
			message: "By topic shows every topic: narrow the stream instead.",
			path: ["topic"],
		})
		.refine((q) => !q.cursor || q.view === "articles" || q.view === "stream", {
			message: "Only By article and Stream have pages.",
			path: ["cursor"],
		}),
	response: json(
		z.discriminatedUnion("view", [
			z.object({
				...NotebookBase,
				view: z.literal("articles"),
				articles: z.array(
					z.object({
						article: NotebookArticle,
						/** Its note, matching or not; null without one. */
						note: z.string().nullable(),
						noteUpdatedAt: Time.nullable(),
						/** Every matching highlight, in reading order. */
						highlights: z.array(Highlight),
					}),
				),
				nextCursor: z.string().nullable(),
			}),
			z.object({
				...NotebookBase,
				view: z.literal("stream"),
				items: z.array(NotebookItem),
				nextCursor: z.string().nullable(),
			}),
			z.object({
				...NotebookBase,
				view: z.literal("topics"),
				/** Topics with the most first; the articles in none of them last (`topic` null). */
				groups: z.array(
					z.object({
						topic: z.object({ id: Id, name: z.string() }).nullable(),
						/** All the matching highlights and notes under it; `items` holds the newest few. */
						highlights: z.number().int(),
						notes: z.number().int(),
						items: z.array(NotebookItem),
					}),
				),
			}),
			z.object({
				...NotebookBase,
				view: z.literal("shuffle"),
				seed: z.string(),
				items: z.array(NotebookItem),
			}),
		]),
	),
	/** `not_found`: `tag` or `topic` is not one of the user's (topics may be off). */
	errors: ["not_found"],
})

/** One of the day's highlights. */
export const DailyHighlight = z
	.object({
		id: Id,
		quote: z.string(),
		note: z.string().nullable(),
		color: z.enum(HIGHLIGHT_COLORS),
		article: HighlightArticle,
	})
	.meta({ id: "DailyHighlight" })
export type DailyHighlight = z.infer<typeof DailyHighlight>

export const listDailyHighlights = defineEndpoint({
	id: "dailyHighlights.list",
	method: "GET",
	path: "/daily-highlights",
	scope: "read",
	summary:
		'Home\'s "From your highlights": a few highlights a day, at least a week old. The first call for a day picks them and records it, as opening Home in the web app does, so a read token changes which ones are picked; every later call for that day answers the same ones, less any deleted, dismissed or trashed since. Notes are edited with PATCH /highlights/{id}.',
	query: z.object({
		/**
		 * The reader's local date (YYYY-MM-DD) on the device: the day starts where they are. A date
		 * more than a day from today in UTC is refused.
		 */
		day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	}),
	response: json(
		z.object({
			day: z.string(),
			/** Oldest first; empty when nothing is old enough. */
			items: z.array(DailyHighlight),
			linkTargets: LinkTargets,
		}),
	),
	errors: [],
})

export const dismissDailyHighlight = defineEndpoint({
	id: "dailyHighlights.dismiss",
	method: "POST",
	path: "/daily-highlights/:id/dismiss",
	scope: "write",
	summary:
		'"Not useful anymore": the highlight is never brought back again. It and its note stay. DELETE undoes it.',
	params,
	response: empty(),
	/** `not_found`: not the user's highlight, deleted, or its article is in the trash. */
	errors: ["not_found"],
})

export const restoreDailyHighlight = defineEndpoint({
	id: "dailyHighlights.restore",
	method: "DELETE",
	path: "/daily-highlights/:id/dismiss",
	scope: "write",
	summary:
		"Undoes a dismissal: the highlight may come back, and shows again today if it was picked today.",
	params,
	response: empty(),
	errors: ["not_found"],
})

/** An article finished lately without a note on it. */
export const NoteReminder = z
	.object({
		article: HighlightArticle,
		finishedAt: Time,
		/** Listened to the end in the app, rather than read. */
		listened: z.boolean(),
		/** A few of its highlights, in the article's order, to bring it back to mind. */
		highlights: z.array(z.object({ id: Id, quote: z.string(), color: z.enum(HIGHLIGHT_COLORS) })),
	})
	.meta({ id: "NoteReminder" })
export type NoteReminder = z.infer<typeof NoteReminder>

export const listNoteReminders = defineEndpoint({
	id: "noteReminders.list",
	method: "GET",
	path: "/note-reminders",
	scope: "read",
	summary:
		'Home\'s gentle question about articles finished lately without a note: read to the end, finished in the reader, or listened to, in the last 14 days, the latest first. Not those finished several at once or from a list unopened, nor those marked "Nothing to add" (POST /articles/{id}/note/skip). `suggested`: whether Home asks now (two or more, or one listened to, and not put off with POST /note-reminders/snooze).',
	response: json(
		z.object({
			/** The latest three. */
			items: z.array(NoteReminder),
			total: z.number().int().nonnegative(),
			suggested: z.boolean(),
		}),
	),
	errors: [],
})

export const snoozeNoteReminders = defineEndpoint({
	id: "noteReminders.snooze",
	method: "POST",
	path: "/note-reminders/snooze",
	scope: "write",
	summary: '"Not now": Home doesn\'t ask about notes for a week. The articles stay listed.',
	response: empty(),
	errors: [],
})

export const skipNote = defineEndpoint({
	id: "articles.skipNote",
	method: "POST",
	path: "/articles/:id/note/skip",
	scope: "write",
	summary:
		'"Nothing to add": the article was finished without a note on purpose, and is never asked about again. DELETE undoes it.',
	params,
	response: empty(),
	/** `not_found`: not the user's article, or in the trash. */
	errors: ["not_found"],
})

export const unskipNote = defineEndpoint({
	id: "articles.unskipNote",
	method: "DELETE",
	path: "/articles/:id/note/skip",
	scope: "write",
	summary: 'Undoes "Nothing to add": the article may be asked about again.',
	params,
	response: empty(),
	errors: ["not_found"],
})

/** Found text in runs; `match` marks a word the search found. Render as text, never as HTML. */
export const Snippet = z
	.array(z.object({ text: z.string(), match: z.literal(true).optional() }))
	.meta({ id: "Snippet" })
export type Snippet = z.infer<typeof Snippet>

const FoundArticle = z.object({
	id: Id,
	/** The title, or the address without one. */
	title: z.string(),
	site: z.string().nullable(),
})

/** Matches each group holds at most. */
export const ANNOTATION_SEARCH_MAX = 100

export const searchAnnotations = defineEndpoint({
	id: "annotations.search",
	method: "GET",
	path: "/search/annotations",
	scope: "read",
	summary:
		"Highlights and article notes with the words of `q`, as the web app's search page groups them beside the articles (GET /search): best matches first, with snippets. `q` takes the same operators, which choose the articles searched (`tag:`, `in:archive`…; the trash never). Date operators count days in UTC.",
	query: z.object({
		q: z.string().trim().min(1).max(QUERY_MAX),
		/** One group only, to show all of it: the other comes back empty. */
		only: z.enum(["highlights", "notes"]).optional(),
		/** Matches per group. */
		limit: z.coerce.number().int().min(1).max(ANNOTATION_SEARCH_MAX).default(5),
	}),
	response: json(
		z.object({
			highlights: z.object({
				items: z.array(
					z.object({
						id: Id,
						color: z.enum(HIGHLIGHT_COLORS),
						quote: Snippet,
						/** Null without a note. */
						note: Snippet.nullable(),
						createdAt: Time,
						article: FoundArticle,
					}),
				),
				/** How many match in all; `items` holds up to `limit`. */
				total: z.number().int(),
			}),
			notes: z.object({
				items: z.array(
					z.object({ note: Snippet, noteUpdatedAt: Time.nullable(), article: FoundArticle }),
				),
				total: z.number().int(),
			}),
		}),
	),
	errors: [],
})
