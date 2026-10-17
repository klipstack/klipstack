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
