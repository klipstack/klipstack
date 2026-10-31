import { z } from "zod"
import { defineEndpoint, empty, json } from "../endpoint"
import { ArticleSummary, Id, Time } from "../schemas"

/**
 * What Home shows beside the library's lists: what the reader finished lately, older saves brought
 * back a few at a time, and the next edition in the masthead's corner.
 */

/** What was finished in the past week. */
export const FinishedLately = z
	.object({
		/** 0 after a week without a finish: Home says nothing then. */
		count: z.number().int().nonnegative(),
		title: z.string().nullable(),
	})
	.meta({ id: "FinishedLately" })
export type FinishedLately = z.infer<typeof FinishedLately>

/** The next edition, as Home's masthead names it. */
export const NextEdition = z
	.object({
		/** Articles marked for the next edition, not in the trash. */
		marked: z.number().int().nonnegative(),
		/**
		 * The draft in progress: the articles going out in it, and whole days since it was started.
		 * Null without one.
		 */
		draft: z
			.object({ items: z.number().int().nonnegative(), days: z.number().int().nonnegative() })
			.nullable(),
		/** Null when no edition is due, or "Not now" (POST /editions/next/snooze) still holds. */
		nudge: z
			.object({
				/** `marked`: enough marked; `stale`: a while since the last; `draft`: the draft is due. */
				reason: z.enum(["marked", "stale", "draft"]),
				/** Whole days since the last edition was published; null before the first. */
				daysSince: z.number().int().nonnegative().nullable(),
				/** Articles finished since the last edition. */
				readSince: z.number().int().nonnegative(),
			})
			.nullable(),
		/** The web's Editions page, where the next edition is put together. */
		url: z.string(),
	})
	.meta({ id: "NextEdition" })
export type NextEdition = z.infer<typeof NextEdition>

export const getFinishedLately = defineEndpoint({
	id: "home.finished",
	method: "GET",
	path: "/home/finished",
	scope: "read",
	summary:
		"What the reader finished in the past week, the line under Home's greeting: today and the 6 days before, as days in `timeZone`. Articles, not completions: one read twice counts once. Only what was read: articles finished several at once or from a list unopened don't count. `title` only when there is one.",
	query: z.object({
		/** An IANA time zone name (`Europe/Madrid`): where the reader's days start. */
		timeZone: z.string().min(1).max(64),
	}),
	response: json(FinishedLately),
	/** `invalid_request`: `timeZone` is no time zone. */
	errors: [],
})

export const listRediscover = defineEndpoint({
	id: "home.rediscover",
	method: "GET",
	path: "/home/rediscover",
	scope: "read",
	summary:
		"Home's \"From a while ago\": unread saves from before `savedBefore`, in the day's order, so older ones come back instead of sinking under newer ones. The order changes each day (UTC) and holds through it. Enough for Home to choose a time without asking again: the first of any length, and for each of Home's time choices (5, 15, 30 and 60 minutes) the first that fit it and the first that take at least half of it. Only ready articles in the library, never opened nor finished. With `topic`, only that topic's.",
	query: z.object({
		/** One of the user's topics (GET /topics). */
		topic: Id.optional(),
	}),
	response: json(
		z.object({
			/** In the day's order. */
			items: z.array(ArticleSummary),
			/**
			 * Saves before this are "a while ago"; with a time chosen, Home's "Recently saved" keeps to
			 * those after it, so long ones from long ago come back here, not as recent.
			 */
			savedBefore: Time,
			/** How many days ago that is, as Home says it ("Saved more than 14 days ago"). */
			afterDays: z.number().int().positive(),
		}),
	),
	/** `not_found`: `topic` is none of the user's topics now. */
	errors: ["not_found"],
})

export const getNextEdition = defineEndpoint({
	id: "editions.next",
	method: "GET",
	path: "/editions/next",
	scope: "read",
	summary:
		"The user's next edition, as Home's masthead names it: the draft in progress and its articles, else the articles marked for it (PATCH /articles with `shortlisted`). `nudge` when an edition is due, as the web's sidebar and Editions page say: enough marked, or a while since the last one with something to share, or a draft a week old. Editions are put together and published on the web, at `url`. With editions turned off for the account (its Settings), nothing marked, no draft and no nudge.",
	response: json(NextEdition),
	errors: [],
})

export const snoozeNextEdition = defineEndpoint({
	id: "editions.snoozeNudge",
	method: "POST",
	path: "/editions/next/snooze",
	scope: "write",
	summary:
		'"Not now" on the nudge for an edition: none for a week, here or on the web. The marks and the draft stay.',
	response: empty(),
	/** `forbidden`: editions are turned off for the account (`GET /me`). */
	errors: ["forbidden"],
})

/** A day in the reader's time zone, which has no zone of its own. */
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** Articles finished, their words, and minutes estimated from each one's length (not timed). */
const ReadTotals = z.object({
	articles: z.number().int().nonnegative(),
	words: z.number().int().nonnegative(),
	minutes: z.number().int().nonnegative(),
})

/** What the reader finished, as the web's Your reading page shows it. */
export const ReadingStats = z
	.object({
		/** The reader's day; every day here is `YYYY-MM-DD`. */
		today: Day,
		/** The past 7 days (as `GET /home/finished` counts them), this month and this year, so far. */
		totals: z.object({ week: ReadTotals, month: ReadTotals, year: ReadTotals }),
		/** Articles finished each day since `from`. Only days with any. */
		days: z.record(Day, z.number().int().positive()),
		/** A Monday, a year of whole weeks before this week's. */
		from: Day,
		/** The last 12 weeks (from Monday) or months, by their first day, the current one last. */
		periods: z.array(ReadTotals.extend({ start: Day })),
		/** One of `periods`, with what was finished in it, the last finished first. */
		selected: z.object({
			start: Day,
			/** Its last day. */
			end: Day,
			articles: z.array(
				z.object({
					id: Id,
					title: z.string().nullable(),
					siteName: z.string().nullable(),
					words: z.number().int().nonnegative(),
					minutes: z.number().int().nonnegative(),
					/** The last day it was finished in the period. */
					day: Day,
				}),
			),
			/** Up to 5 of the reader's topics it was in, most articles first; none without topics. */
			topics: z.array(
				z.object({ id: Id, name: z.string(), articles: z.number().int().positive() }),
			),
		}),
	})
	.meta({ id: "ReadingStats" })
export type ReadingStats = z.infer<typeof ReadingStats>

export const getReadingStats = defineEndpoint({
	id: "reading.get",
	method: "GET",
	path: "/reading",
	scope: "read",
	summary:
		"What the reader finished, as the web's Your reading page shows it: totals for the past 7 days, this month and this year; a year of days; and the last 12 weeks (`by=week`, from Monday) or months, one of them `selected` with what was finished in it and its topics. Counted as `GET /home/finished` counts: articles, not completions, without those finished several at once or in the trash. Days are in `timeZone`. `start` chooses a period by its first day; one not shown is the current one.",
	query: z.object({
		/** An IANA time zone name (`Europe/Madrid`): where the reader's days start. */
		timeZone: z.string().min(1).max(64),
		by: z.enum(["week", "month"]).default("week"),
		/** The first day of one of `periods`. */
		start: Day.optional(),
	}),
	response: json(ReadingStats),
	/** `invalid_request`: `timeZone` is no time zone. */
	errors: [],
})
