import { type DocumentEvent, listenDocumentEvents } from "@klipstack/db"

/** An event, or null when events may have been missed: what the stream's page shows may be old. */
type Subscriber = (event: DocumentEvent | null) => void

const subscribers = new Map<string, Set<Subscriber>>()
let stopListening: (() => void) | null = null
/** Since when this process hears every event (LISTEN in place); null while it doesn't. */
let listeningSince: number | null = null
/**
 * When each user's last event arrived, for streams that open after it. Kept for `REMEMBER_MS`
 * only, so it holds the users active lately, not every user since the process started: a page
 * read longer ago than that refreshes when its stream opens.
 */
const lastEventAt = new Map<string, number>()
const REMEMBER_MS = 10 * 60_000
let forgotAt = 0

function remember(userId: string, now: number) {
	lastEventAt.set(userId, now)
	if (now - forgotAt < REMEMBER_MS) return
	forgotAt = now
	for (const [id, at] of lastEventAt) if (now - at > REMEMBER_MS) lastEventAt.delete(id)
}

/** Whether a page read at `since` may have missed one of the user's events. */
function mayHaveMissed(userId: string, since: number, now: number) {
	if (listeningSince === null) return false // it hears null once LISTEN is in place
	return (
		listeningSince >= since ||
		(lastEventAt.get(userId) ?? 0) >= since ||
		// Older than what is remembered, or ahead of this clock (another server read the page).
		now - since > REMEMBER_MS ||
		since > now
	)
}

/**
 * Delivers a user's document events to every open stream of theirs. Starts LISTEN on first use.
 * `since` is when the stream's page read what it shows: if an event for the user came after it
 * (before the stream opened), or may have, the subscriber gets null at once. It gets null again
 * whenever LISTEN comes back after a dropped connection.
 */
export function subscribeDocumentEvents(
	userId: string,
	since: number,
	subscriber: Subscriber,
): () => void {
	let set = subscribers.get(userId)
	if (!set) {
		set = new Set()
		subscribers.set(userId, set)
	}
	set.add(subscriber)
	if (!stopListening) {
		stopListening = listenDocumentEvents(
			(event) => {
				remember(event.userId, Date.now())
				for (const fn of subscribers.get(event.userId) ?? []) fn(event)
			},
			() => {
				listeningSince = Date.now()
				for (const fns of subscribers.values()) for (const fn of fns) fn(null)
			},
		)
	}
	if (mayHaveMissed(userId, since, Date.now())) subscriber(null)
	return () => {
		set?.delete(subscriber)
		if (set?.size === 0) subscribers.delete(userId)
	}
}

/** Stops listening for good (shutdown). */
export function stopDocumentEvents() {
	stopListening?.()
	stopListening = null
	listeningSince = null
	subscribers.clear()
	lastEventAt.clear()
	forgotAt = 0
}
