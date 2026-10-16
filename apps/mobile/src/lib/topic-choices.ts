import type { FilterChoice, ListSort } from "./library-filters"
import type { TopicChoice } from "./library-topics"

/**
 * Each library list's topic (`library-topics.ts`), filter and order (`library-filters.ts`), while
 * the app runs: a list opened again shows what it had. They go with the session (`auth.tsx`):
 * topics are the reader's own.
 */
const choices = new Map<string, TopicChoice>()
const filters = new Map<string, FilterChoice>()
const sorts = new Map<string, ListSort>()
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

/** The filter a list shows now; null for all of it. */
export function filterOf(view: string): FilterChoice {
	return filters.get(view) ?? null
}

/** The order a list shows, when the reader chose one; null for the filter's own. */
export function sortOf(view: string): ListSort | null {
	return sorts.get(view) ?? null
}

/**
 * A filter and an order together. An order the reader didn't choose (null) follows the filter's
 * own (`defaultSort`); one they chose stays when the filter changes, as on the web.
 */
export function chooseFilter(view: string, filter: FilterChoice, sort: ListSort | null) {
	if (filterOf(view) === filter && sortOf(view) === sort) return
	filters.set(view, filter)
	if (sort) sorts.set(view, sort)
	else sorts.delete(view)
	changed()
}

/** Called on each change; returns the way to stop. */
export function onTopicChange(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

/**
 * Every list shows all of it again, every topic, in its own order: signed out, the next reader's
 * topics are not these.
 */
export function forgetListChoices() {
	if (choices.size === 0 && filters.size === 0 && sorts.size === 0) return
	choices.clear()
	filters.clear()
	sorts.clear()
	changed()
}
