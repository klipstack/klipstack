import { snoozeReview } from "~/services/review.server"

/**
 * Opening the review of old saves, or "Not now" on Home's card for it: no card for a month
 * (`REVIEW.snoozeDays`). Keeping, archiving and deleting are article changes (`./articles.server`).
 */
export function snoozeReviewSuggestion(userId: string) {
	return snoozeReview(userId)
}
