export interface Box {
	left: number
	top: number
	width: number
	height: number
}

type Rect = {
	left: number
	right: number
	top: number
	bottom: number
	width: number
	height: number
}

/**
 * One box per line of a highlight, from its range's rectangles, moved by `offset` (the scroll, for
 * boxes in the page's coordinates). A line split by links or emphasis has several rectangles; they
 * join into one. Empty rectangles (line ends, collapsed whitespace) are skipped. As the web's
 * `lineBoxes` (apps/web/app/components/highlight-outline.tsx).
 */
export function lineBoxes(rects: Iterable<Rect>, offset: { x: number; y: number }): Box[] {
	const lines: Array<{ left: number; right: number; top: number; bottom: number }> = []
	for (const r of rects) {
		if (r.width < 1 || r.height < 1) continue
		const mid = (r.top + r.bottom) / 2
		const line = lines.find((l) => mid > l.top && mid < l.bottom)
		if (line) {
			line.left = Math.min(line.left, r.left)
			line.right = Math.max(line.right, r.right)
			line.top = Math.min(line.top, r.top)
			line.bottom = Math.max(line.bottom, r.bottom)
		} else lines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
	}
	return lines.map((l) => ({
		left: l.left + offset.x,
		top: l.top + offset.y,
		width: l.right - l.left,
		height: l.bottom - l.top,
	}))
}
