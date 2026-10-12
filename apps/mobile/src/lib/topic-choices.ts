import type { TopicChoice } from "./library-topics"

/**
 * Each library list's topic (`library-topics.ts`), while the app runs: a list opened again shows
 * the topic it had. They go with the session (`auth.tsx`): topics are the reader's own.
 */
const choices = new Map<string, TopicChoice>()
const listeners = new Set<() => void>()

function changed() {
	for (const listener of listeners) listener()
}

/** The topic a list shows now; null for every topic. */
export function topicOf(view: string): TopicChoice {
	return choices.get(view) ?? null
}

export function chooseTopic(view: string, next: TopicChoice) {
	if (topicOf(view) === next) return
	choices.set(view, next)
	changed()
}

/** Called on each change; returns the way to stop. */
export function onTopicChange(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

/** Every list shows every topic again: signed out, the next reader's topics are not these. */
export function forgetTopics() {
	if (choices.size === 0) return
	choices.clear()
	changed()
}
