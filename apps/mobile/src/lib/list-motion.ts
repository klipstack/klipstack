import type { ArticleSummary } from "@klipstack/sdk"

/**
 * The lists' key actions, played as the web's (apps/web/app/lib/motion.ts, `.motion-*` in app.css):
 * an article archived out of a list is stamped "Archived" and filed away; deleted, restored or
 * moved back to the Inbox, it is lifted away; archived where it stays (Starred), only the stamp
 * comes down on it; just saved, it drops in and the logo's paper clip clips it; back by Undo, it
 * fades in where it was. The pure parts; `components/list-motion.tsx` plays them.
 */
export type Motion = "archive" | "lift" | "stamp" | "arrive" | "return"

/** How long a leaving article stays on screen, in ms: the web's ghost-archive and ghost-lift. */
export const LEAVE_MS: Record<"archive" | "lift", number> = { archive: 520, lift: 260 }

/** How an article changed by an action goes: leaving the list (`shown` false) or staying in it. */
export function actionMotion(
	before: ArticleSummary,
	after: ArticleSummary,
	shown: boolean,
): Motion | null {
	const archived = before.location !== "archive" && after.location === "archive"
	if (shown) return archived ? "stamp" : null
	return archived && !after.trashedAt ? "archive" : "lift"
}

/**
 * The list as it shows: `next`, with the articles still leaving kept where they were in `shown`
 * (after the article before them that is still there), so the rest don't jump before they go.
 */
export function withLeaving<T extends { id: string }>(
	shown: readonly T[],
	next: readonly T[],
	leaving: ReadonlySet<string>,
): T[] {
	const result = [...next]
	const ids = new Set(next.map((item) => item.id))
	let before: string | null = null
	for (const item of shown) {
		if (leaving.has(item.id) && !ids.has(item.id)) {
			const at = before === null ? 0 : result.findIndex((r) => r.id === before) + 1
			result.splice(at, 0, item)
			ids.add(item.id)
		}
		if (ids.has(item.id)) before = item.id
	}
	return result
}

/**
 * The articles that came into a list already shown: back by Undo (`return`: they left it here) or
 * just saved (`arrive`: saved after every article it showed, among them). A list's first page, or
 * a page loaded further down, plays nothing.
 */
export function entering(
	shown: readonly ArticleSummary[] | null,
	next: readonly ArticleSummary[],
	leftHere: ReadonlySet<string>,
): Map<string, Motion> {
	const motions = new Map<string, Motion>()
	if (!shown?.length) return motions
	const was = new Set(shown.map((a) => a.id))
	const newest = Math.max(...shown.map((a) => new Date(a.savedAt).getTime()))
	// Past the last article shown before: a further page, not an arrival.
	const lastShown = next.findLastIndex((a) => was.has(a.id))
	next.forEach((article, i) => {
		if (was.has(article.id)) return
		// Back where it was, the end of the list too.
		if (leftHere.has(article.id)) motions.set(article.id, "return")
		else if (i < lastShown && new Date(article.savedAt).getTime() > newest)
			motions.set(article.id, "arrive")
	})
	return motions
}

/** What an action asked of an article: its motion, and the archive stamp's date (today's). */
export type Act = { motion: Motion; date: string }

/** A list's motion between its loads and edits: `useListMotion` keeps it. */
export type MotionState = {
	/** The list as it is. */
	items: ArticleSummary[] | null
	/** As it shows: with the articles still leaving. */
	data: ArticleSummary[] | null
	leaving: ReadonlyMap<string, ArticleSummary>
	playing: ReadonlyMap<string, Act>
	/** Articles that left by an action here: back, they came back by Undo. */
	left: ReadonlySet<string>
}

export function motionState(items: ArticleSummary[] | null): MotionState {
	return { items, data: items, leaving: new Map(), playing: new Map(), left: new Set() }
}

/**
 * The list's new state for new `items`: the articles that left by an action (`acts`) stay to
 * play; those archived where they stay get the stamp; newcomers drop in or come back.
 */
export function advance(
	state: MotionState,
	items: ArticleSummary[] | null,
	acts: ReadonlyMap<string, Act>,
): MotionState {
	const before = state.data
	if (!items || !before) return { ...state, items, data: items }
	const ids = new Set(items.map((a) => a.id))
	const leaving = new Map(state.leaving)
	const playing = new Map(state.playing)
	const left = new Set(state.left)
	for (const article of before) {
		const act = acts.get(article.id)
		if (ids.has(article.id) || leaving.has(article.id) || !act) continue
		if (act.motion === "archive" || act.motion === "lift") {
			leaving.set(article.id, article)
			playing.set(article.id, act)
			left.add(article.id)
		}
	}
	for (const [id, act] of acts) if (act.motion === "stamp" && ids.has(id)) playing.set(id, act)
	const stayed = before.filter((a) => !state.leaving.has(a.id))
	for (const [id, motion] of entering(stayed, items, left)) {
		playing.set(id, { motion, date: "" })
		left.delete(id)
	}
	const data = leaving.size ? withLeaving(before, items, new Set(leaving.keys())) : items
	return { items, data, leaving, playing, left }
}

/** The state once an article's motion has played: gone, if it was leaving. */
export function settle(state: MotionState, id: string): MotionState {
	if (!state.playing.has(id)) return state
	const playing = new Map(state.playing)
	playing.delete(id)
	const leaving = new Map(state.leaving)
	leaving.delete(id)
	const data =
		state.items && state.leaving.has(id)
			? withLeaving(state.data ?? [], state.items, new Set(leaving.keys()))
			: state.data
	return { ...state, playing, leaving, data }
}
