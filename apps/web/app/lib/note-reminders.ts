/**
 * Articles finished without a note, which Home gently asks about; safe to import from client code.
 * The text says "a week": change `noteReminders.*` in both locales with `snoozeDays`.
 */
export const NOTE_REMINDERS = {
	/** Finished in the last this many days: after that, what it left is mostly gone. */
	withinDays: 14,
	/**
	 * Not while the article is fresh: whoever finished it may still be at its note. Listened to is
	 * asked about at once: the note at the end went by with the phone in a pocket.
	 */
	graceMinutes: 10,
	/** Home asks when at least this many wait, or any was listened to. */
	minToSuggest: 2,
	/** "Not now" keeps Home's card away this long. */
	snoozeDays: 7,
	/** The card shows this many, the latest finished first. */
	shown: 3,
} as const
