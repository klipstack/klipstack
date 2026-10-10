import { useEffect, useState } from "react"

interface Box {
	left: number
	top: number
	width: number
	height: number
}

/**
 * Raises the highlight in focus: a line around each line of it (`.hl-pop` in app.css).
 * The CSS Custom Highlight API can only paint a background, so the line is drawn over the
 * article, from the range's rectangles. Pointer events go through to the text and the handles.
 */
export function HighlightOutline({
	articleRef,
	rangesRef,
	id,
	version,
}: {
	articleRef: React.RefObject<HTMLElement | null>
	rangesRef: React.RefObject<Map<string, Range>>
	id: string | null
	/** Changes whenever the ranges are rebuilt (the highlight list). */
	version: unknown
}) {
	const [measured, setMeasured] = useState<{ id: string | null; boxes: Box[] }>({
		id: null,
		boxes: [],
	})
	useEffect(() => {
		const article = articleRef.current
		if (!article || id === null) return
		let frame = 0
		const measure = () => {
			cancelAnimationFrame(frame)
			frame = requestAnimationFrame(() => {
				const range = rangesRef.current.get(id)
				setMeasured({ id, boxes: range ? lineBoxes(range, article.getBoundingClientRect()) : [] })
			})
		}
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(article)
		window.addEventListener("resize", measure)
		article.addEventListener("load", measure, true)
		document.fonts.addEventListener("loadingdone", measure)
		return () => {
			cancelAnimationFrame(frame)
			observer.disconnect()
			window.removeEventListener("resize", measure)
			article.removeEventListener("load", measure, true)
			document.fonts.removeEventListener("loadingdone", measure)
		}
	}, [articleRef, rangesRef, id, version])

	if (id === null || measured.id !== id) return null
	return (
		<div aria-hidden className="pointer-events-none absolute inset-0 z-[5]">
			{measured.boxes.map((box) => (
				<span key={`${box.left},${box.top}`} className="hl-pop hl-outline" style={box} />
			))}
		</div>
	)
}

/**
 * One box per line, relative to `origin`. A line split by links or emphasis has several rectangles;
 * they join into one. Empty rectangles (line ends, collapsed whitespace) are skipped.
 */
export function lineBoxes(range: Range, origin: { left: number; top: number }): Box[] {
	const lines: Array<{ left: number; right: number; top: number; bottom: number }> = []
	for (const r of Array.from(range.getClientRects())) {
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
		left: l.left - origin.left,
		top: l.top - origin.top,
		width: l.right - l.left,
		height: l.bottom - l.top,
	}))
}
