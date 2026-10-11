/** Home's sections, chosen from the candidates the server sends; safe to import from client code. */

/** Library articles Home features at most: in progress, saved lately, and from a while ago. */
export const HOME_SHELF = { reading: 3, recent: 4, rediscover: 3 } as const

/**
 * Home offers the time choice when the library holds more unfinished articles than this: more than
 * Home shows at once (the recent saves give their fourth place to an article in progress), so
 * there is something to narrow down.
 */
export const TIME_FILTER_MIN = HOME_SHELF.reading + HOME_SHELF.recent - 1 + HOME_SHELF.rediscover

/** `minutesLeft` is null for what has no reading time to count: posts, and articles without a length. */
export interface Timed {
	id: string
	minutesLeft: number | null
	createdAt: Date
}

export function fitsIn(doc: Timed, minutes: number | null) {
	return minutes === null || (doc.minutesLeft !== null && doc.minutesLeft <= minutes)
}

/** Takes at least half the time chosen: with more time, longer articles come first. */
export function fillsTime(doc: Timed, minutes: number) {
	return fitsIn(doc, minutes) && doc.minutesLeft! * 2 >= minutes
}

/**
 * The sections for a time choice (null: any length), each article once. Without a choice, each
 * section keeps its order. With one, time left counts, not length:
 *
 * - Continue reading shows what can be finished in the time, read last first. When nothing can, it
 *   still shows the article read last: finishing what was started comes before starting more.
 * - The unread sections show what fits, those that fill at least half the time first, so more time
 *   brings longer articles; each group in the section's order. Recently saved keeps to saves after
 *   `recentSince`, so long ones from long ago come back under From a while ago, not as recent.
 *
 * With nothing in progress, the recent saves get a fourth article: the first takes the big card.
 */
export function homeShelves<T extends Timed>(
	candidates: { reading: T[]; recent: T[]; rediscover: T[]; recentSince: Date },
	minutes: number | null,
) {
	const shown = new Set<string>()
	const take = (items: T[], max: number) => {
		const out: T[] = []
		for (const item of items) {
			if (out.length === max) break
			if (shown.has(item.id) || !fitsIn(item, minutes)) continue
			shown.add(item.id)
			out.push(item)
		}
		return out
	}
	const fillingFirst = (items: T[]) =>
		minutes === null
			? items
			: [
					...items.filter((d) => fillsTime(d, minutes)),
					...items.filter((d) => !fillsTime(d, minutes)),
				]
	const reading = take(candidates.reading, HOME_SHELF.reading)
	const readLast = candidates.reading[0]
	if (!reading.length && readLast) {
		shown.add(readLast.id)
		reading.push(readLast)
	}
	const recentSaves =
		minutes === null
			? candidates.recent
			: candidates.recent.filter((d) => d.createdAt >= candidates.recentSince)
	const recent = take(fillingFirst(recentSaves), HOME_SHELF.recent - (reading.length ? 1 : 0))
	const rediscover = take(fillingFirst(candidates.rediscover), HOME_SHELF.rediscover)
	return { reading, recent, rediscover }
}

/** A title for a sentence: at most `max` characters, cut after a word and ended with "…". */
export function shortTitle(title: string, max: number): string {
	if (title.length <= max) return title
	const cut = title.slice(0, max - 1)
	const space = cut.lastIndexOf(" ")
	return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}
