/**
 * Reviewing old saves never opened, to keep or let go of them; safe to import from client code.
 * From a while ago brings unread saves back after two weeks (`REDISCOVER_AFTER_DAYS`); after a
 * month, the review offers to let them go as well. The text says "a month", "three months": change
 * `review.*` in both locales with `afterDays` and `keepDays`.
 */
export const REVIEW = {
	/** Saved more than this many days ago, and never touched since. */
	afterDays: 30,
	/** Home suggests the review when at least this many saves are in it: fewer are no clutter. */
	minToSuggest: 5,
	/** Opening the review, or "Not now" on Home's card, keeps the card away this long. */
	snoozeDays: 30,
	/** A kept save is not suggested for letting go again for this long. */
	keepDays: 90,
	/** The review lists this many at a time, the oldest first. */
	pageSize: 25,
} as const
