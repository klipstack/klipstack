/** Home's sections, chosen from the candidates the server sends; safe to import from client code. */

/** Library articles Home features at most: in progress, saved lately, and from a while ago. */
export const HOME_SHELF = { reading: 3, recent: 4, rediscover: 3 } as const

/**
 * Home offers the time choice when the library holds more unfinished articles than this: more than
 * Home shows at once, so there is something to narrow down.
 */
export const TIME_FILTER_MIN = HOME_SHELF.reading + HOME_SHELF.recent + HOME_SHELF.rediscover

/** `minutesLeft` is null for what has no reading time to count: posts, and articles without a length. */
export interface Timed {
	id: string
	minutesLeft: number | null
}

export function fitsIn(doc: Timed, minutes: number | null) {
	return minutes === null || (doc.minutesLeft !== null && doc.minutesLeft <= minutes)
}

/**
 * The sections for a time choice (null: any length), each in its own order and each article once.
 * With nothing in progress, the recent saves get a fourth article: the newest takes the big card.
 */
export function homeShelves<T extends Timed>(
	candidates: { reading: T[]; recent: T[]; rediscover: T[] },
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
	const reading = take(candidates.reading, HOME_SHELF.reading)
	const recent = take(candidates.recent, HOME_SHELF.recent - (reading.length ? 1 : 0))
	const rediscover = take(candidates.rediscover, HOME_SHELF.rediscover)
	return { reading, recent, rediscover }
}
