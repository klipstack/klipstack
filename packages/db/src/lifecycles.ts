/**
 * Lifecycles kept in nullable timestamps rather than a status column, when the web app and the
 * worker both read them: each derived state named once, so its definition cannot drift. The web
 * app's own are beside the code that owns them; docs/development/state-machines.md lists them all.
 */

/**
 * The reader's first topics (`topic_libraries`): `proposing` until the worker has proposed some
 * (`proposedAt`), `proposed` until the reader confirms them (`confirmedAt`), then `confirmed`.
 */
export type TopicLibraryStage = "proposing" | "proposed" | "confirmed"

export function topicLibraryStage(library: {
	proposedAt: Date | null
	confirmedAt: Date | null
}): TopicLibraryStage {
	if (library.confirmedAt) return "confirmed"
	return library.proposedAt ? "proposed" : "proposing"
}
