export interface MarginItem {
	id: string
	/** Where the note wants to be: the top of its highlight's first line. */
	wantedTop: number
	height: number
	/** Tie-break for highlights starting on the same line: text order. */
	start: number
}

/**
 * Place margin notes level with their highlights, pushing each one below the note above it when
 * they would overlap.
 */
export function layoutMargin(items: MarginItem[], gap: number): Map<string, number> {
	const sorted = [...items].sort((a, b) => a.wantedTop - b.wantedTop || a.start - b.start)
	const tops = new Map<string, number>()
	let bottom = Number.NEGATIVE_INFINITY
	for (const item of sorted) {
		const top = Math.max(item.wantedTop, bottom + gap)
		tops.set(item.id, top)
		bottom = top + item.height
	}
	return tops
}

/** Whether two layouts place the same items within half a pixel: a renamed item is a change. */
export function sameTops(a: Map<string, number>, b: Map<string, number>): boolean {
	if (a.size !== b.size) return false
	for (const [id, top] of b) {
		const was = a.get(id)
		if (was === undefined || Math.abs(was - top) > 0.5) return false
	}
	return true
}
