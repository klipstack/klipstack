import { type DocumentEvent, listenDocumentEvents } from "@klipstack/db"

type Subscriber = (event: DocumentEvent) => void

const subscribers = new Map<string, Set<Subscriber>>()
let stopListening: (() => void) | null = null

/** Delivers a user's document events to every open stream of theirs. Starts LISTEN on first use. */
export function subscribeDocumentEvents(userId: string, subscriber: Subscriber): () => void {
	let set = subscribers.get(userId)
	if (!set) {
		set = new Set()
		subscribers.set(userId, set)
	}
	set.add(subscriber)
	if (!stopListening) {
		stopListening = listenDocumentEvents((event) => {
			for (const fn of subscribers.get(event.userId) ?? []) fn(event)
		})
	}
	return () => {
		set?.delete(subscriber)
		if (set?.size === 0) subscribers.delete(userId)
	}
}

/** Stops listening for good (shutdown). */
export function stopDocumentEvents() {
	stopListening?.()
	stopListening = null
	subscribers.clear()
}
