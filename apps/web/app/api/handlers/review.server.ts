import type { getReviewSuggestion, listReview, snoozeReview } from "@klipstack/api-contract"
import { snoozeReviewSuggestion } from "~/commands/review.server"
import { REVIEW } from "~/lib/review"
import { articleSummary } from "~/services/article-summary.server"
import { listReview as reviewPage, reviewSuggested } from "~/services/review.server"
import type { Handler } from "../handler.server"

/** The review of old saves, as the web's /library/review and Home's card for it load it. */

export const list: Handler<typeof listReview> = async ({ userId }) => {
	const { items, more } = await reviewPage(userId)
	return {
		items: items.map(articleSummary),
		more,
		afterDays: REVIEW.afterDays,
		keepDays: REVIEW.keepDays,
	}
}

export const suggested: Handler<typeof getReviewSuggestion> = async ({ userId }) => ({
	suggested: await reviewSuggested(userId),
})

export const snooze: Handler<typeof snoozeReview> = async ({ userId }) => {
	await snoozeReviewSuggestion(userId)
}
