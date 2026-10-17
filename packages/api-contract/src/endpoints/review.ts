import { z } from "zod"
import { defineEndpoint, empty, json } from "../endpoint"
import { ArticleSummary } from "../schemas"

/**
 * The review of old saves, as the web's /library/review: saves from long ago never opened, to keep
 * or let go of. Keeping is PATCH /articles with `kept`; archiving and deleting are the usual
 * changes (PATCH /articles with `location`, POST /articles/trash).
 */

export const listReview = defineEndpoint({
	id: "review.list",
	method: "GET",
	path: "/review",
	scope: "read",
	summary:
		"The review of old saves: ready articles in the library saved more than `afterDays` days ago and never touched since, the oldest first, a page at a time. Never touched: not opened nor finished, nor put back to read again, without a star, a mark for the next edition, a note or highlights (tags don't count). Articles kept (PATCH /articles with `kept: true`) are left out for `keepDays` days. Each one kept, archived or deleted leaves the review, and the next call brings the next ones.",
	response: json(
		z.object({
			/** The oldest first. */
			items: z.array(ArticleSummary),
			/** More are waiting after these. */
			more: z.boolean(),
			/** Saved more than this many days ago. */
			afterDays: z.number().int().positive(),
			/** Kept articles are left out for this many days. */
			keepDays: z.number().int().positive(),
		}),
	),
	errors: [],
})

export const getReviewSuggestion = defineEndpoint({
	id: "review.suggested",
	method: "GET",
	path: "/review/suggested",
	scope: "read",
	summary:
		"Whether Home suggests the review of old saves, as the web's Home does: enough articles in it to be worth it, and the suggestion not put off (POST /review/snooze).",
	response: json(z.object({ suggested: z.boolean() })),
	errors: [],
})

export const snoozeReview = defineEndpoint({
	id: "review.snooze",
	method: "POST",
	path: "/review/snooze",
	scope: "write",
	summary:
		'Puts off Home\'s suggestion of the review for a month, here and on the web: "Not now", or the review opened from it. The articles stay as they are.',
	response: empty(),
	errors: [],
})
